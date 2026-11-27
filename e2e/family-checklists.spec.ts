import { expect, test, type Page } from '@playwright/test';
import { hydrated, settle } from './support/navigation';

async function signIn(page: Page, email: string, password: string) {
  const origin = 'http://127.0.0.1:4173';
  const response = await page.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email, password } });
  expect(response.status()).toBe(200);
}

test('a parent shares a packing list and a child marks an item ready', async ({ page, browser }, testInfo) => {
  const title = testInfo.repeatEachIndex ? 'Weekend Trip Packing ' + testInfo.repeatEachIndex : 'Weekend Trip Packing';
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, 'parent@example.test', 'synthetic-parent-password');
  await page.goto('/dashboard');
  await expect(page.getByRole('link', { name: 'Family lists', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Family lists', exact: true }).click();
  await settle(page);
  const create = page.getByRole('form', { name: 'Create a family list' });
  await create.getByLabel('List name').fill(title);
  await create.getByLabel('Share with family').check();
  await create.getByRole('button', { name: 'Create list' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const add = page.getByRole('form', { name: 'Add things to do' });
  const names = ['Coats', 'Chargers', 'Books', 'Socks', 'Pajamas', 'Toothbrushes', 'Toothpaste', 'Water bottles', 'Snacks', 'Rain boots', 'Gloves', 'Hats', 'Maps', 'Games', 'Pillows'];
  await add.getByLabel('Things to add').fill(names.join('\n'));
  await add.getByRole('button', { name: 'Add items' }).click();
  await expect(page.getByText('0 of 15 items ready')).toBeVisible();
  const listUrl = page.url();
  const childContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  try {
    const child = await childContext.newPage();
    await signIn(child, 'kid@example.test', 'synthetic-kid-password');
    await child.goto('/dashboard');
    await child.getByRole('link', { name: 'Family lists', exact: true }).click();
    await settle(child);
    await expect(child.getByRole('link', { name: title })).toBeVisible();
    await child.goto(listUrl);
    await child.getByRole('article', { name: 'Coats' }).getByRole('button', { name: 'Mark ready' }).click();
    await expect(child.getByText('1 of 15 items ready')).toBeVisible();
    await child.screenshot({ path: testInfo.outputPath('family-list-child-phone.png') });
    await page.reload();
    await expect(page.getByText('1 of 15 items ready')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
    await page.screenshot({ path: testInfo.outputPath('family-list-phone.png') });
  } finally { await childContext.close(); }
});

test('stale list edits remain rejected until the parent refreshes', async ({ page, browser }) => {
  const title = `Synthetic stale list ${Date.now()}`;
  await signIn(page, 'parent@example.test', 'synthetic-parent-password');
  await page.goto('/lists');
  const create = page.getByRole('form', { name: 'Create a family list' });
  await create.getByLabel('List name').fill(title);
  await create.getByRole('button', { name: 'Create list' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const url = page.url();
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await signIn(other, 'parent@example.test', 'synthetic-parent-password');
    await other.goto(url);
    await page.getByText('List details', { exact: true }).click();
    const first = page.getByRole('form', { name: 'Edit list details' });
    await first.getByLabel('List name').fill(`${title} first draft`);
    await other.getByText('List details', { exact: true }).click();
    const second = other.getByRole('form', { name: 'Edit list details' });
    await second.getByLabel('List name').fill(`${title} saved elsewhere`);
    await second.getByRole('button', { name: 'Save list details' }).click();
    await expect(other.getByRole('heading', { name: `${title} saved elsewhere` })).toBeVisible();
    await first.getByRole('button', { name: 'Save list details' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByLabel('List name')).toHaveValue(`${title} first draft`);
    const retry = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('?/update'));
    await first.getByRole('button', { name: 'Save list details' }).click();
    expect((await retry).status()).toBe(409);
    await expect(page.getByRole('alert')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: `${title} saved elsewhere` })).toBeVisible();
  } finally { await otherContext.close(); }
});

test('list details entered before hydration survive and are submitted', async ({ page, browser }) => {
  const title = `Synthetic delayed list ${Date.now()}`;
  await signIn(page, 'parent@example.test', 'synthetic-parent-password');
  const context = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  let release!: () => void, requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const request = new Promise<void>(resolve => { requested = resolve; });
  try {
    const delayed = await context.newPage();
    await delayed.route('**/src/routes/lists/+page.svelte*', async route => { requested(); await gate; await route.continue(); });
    await delayed.goto('/lists', { waitUntil: 'commit' });
    await request;
    const form = delayed.getByRole('form', { name: 'Create a family list' });
    await form.getByLabel('List name').fill(title);
    await form.getByLabel('Share with family').check();
    await form.getByLabel('Description (optional)').fill('Packing notes before hydration');
    await form.getByLabel('Target date (optional)').fill('2099-12-25');
    release();
    await hydrated(delayed);
    await expect(form.getByLabel('List name')).toHaveValue(title);
    await expect(form.getByLabel('Share with family')).toBeChecked();
    expect(await form.evaluate(element => Object.fromEntries(new FormData(element as HTMLFormElement)))).toMatchObject({ name: title, description: 'Packing notes before hydration', targetDate: '2099-12-25', shared: 'yes' });
    await form.getByRole('button', { name: 'Create list' }).click();
    await expect(delayed.getByText(/Shared with family/)).toBeVisible();
    await expect(delayed.locator('header').getByText('Packing notes before hydration', { exact: true })).toBeVisible();
  } finally { release(); await context.close(); }
});

for (const javaScriptEnabled of [false, true]) {
  test('private lists, validation and archive recovery with JavaScript ' + javaScriptEnabled, async ({ browser, page }) => {
    const { origin } = new URL(test.info().project.use.baseURL!);
    const title = 'Synthetic gift list ' + Date.now();
    const description = 'Synthetic hidden gift details ' + Date.now();
    const anonymous = await page.request.get('/lists', { maxRedirects: 0 });
    expect(anonymous.status()).toBe(303);
    const parentContext = await browser.newContext({ javaScriptEnabled, viewport: { width: 375, height: 812 } });
    const childContext = await browser.newContext();
    try {
      const parent = await parentContext.newPage();
      await signIn(parent, 'parent@example.test', 'synthetic-parent-password');
      await parent.goto('/lists');
      const create = parent.getByRole('form', { name: 'Create a family list' });
      await expect(create.getByLabel('Share with family')).not.toBeChecked();
      await create.getByLabel('List name').fill('   ');
      await create.getByLabel('Description (optional)').fill(description);
      await create.getByLabel('Target date (optional)').fill('2099-12-25');
      await create.getByRole('button', { name: 'Create list' }).click();
      await expect(parent.getByRole('alert')).toContainText('Check the list name');
      if (javaScriptEnabled) await expect(create.getByLabel('List name')).toBeFocused();
      await expect(create.getByLabel('Description (optional)')).toHaveValue(description);
      await expect(create.getByLabel('Target date (optional)')).toHaveValue('2099-12-25');
      await create.getByLabel('List name').fill(title);
      await create.getByRole('button', { name: 'Create list' }).click();
      await expect(parent.getByRole('heading', { name: title })).toBeVisible();
      const url = new URL(parent.url());
      url.search = '';
      const child = await childContext.newPage();
      await signIn(child, 'kid@example.test', 'synthetic-kid-password');
      const directory = await child.request.get('/lists');
      expect(directory.status()).toBe(200);
      expect(directory.headers()['cache-control']).toBe('no-store');
      expect(await directory.text()).not.toContain(title);
      const hidden = await child.request.get(url.href);
      expect(hidden.status()).toBe(404);
      const hiddenHtml = await hidden.text();
      expect(hiddenHtml).not.toContain(description);
      expect(hiddenHtml).not.toContain(title);
      for (const path of ['/lists/__data.json', url.pathname + '/__data.json']) {
        const response = await child.request.get(path);
        expect(response.headers()['cache-control']).toBe('no-store');
        const data = await response.text();
        expect(data).not.toContain(description);
        expect(data).not.toContain(title);
      }
      const forbidden = await child.request.post('/lists?/create', {
        headers: { origin, 'x-sveltekit-action': 'true', accept: 'application/json' },
        form: { name: 'Synthetic unauthorized list', requestId: '563c3a90-9d75-445a-b47d-20ad5e8750f1' }
      });
      expect(forbidden.status()).toBe(403);
      expect(await forbidden.json()).toMatchObject({ type: 'failure', status: 403 });

      const add = parent.getByRole('form', { name: 'Add things to do' });
      await add.getByLabel('Things to add').fill('Gift tag\n' + 'x'.repeat(121));
      await add.getByRole('button', { name: 'Add items' }).click();
      await expect(parent.getByRole('alert')).toContainText('Check your items');
      if (javaScriptEnabled) await expect(add.getByLabel('Things to add')).toBeFocused();
      await expect(add.getByLabel('Things to add')).toHaveValue('Gift tag\n' + 'x'.repeat(121));
      await expect(parent.getByText('0 of 0 items ready')).toBeVisible();
      await add.getByLabel('Things to add').fill('Gift tag');
      await add.getByRole('button', { name: 'Add items' }).click();
      const item = parent.getByRole('article', { name: 'Gift tag', exact: true });
      await expect(item).toBeVisible();
      await item.getByRole('button', { name: 'Mark ready', exact: true }).click();
      await expect(parent.getByText('1 of 1 items ready')).toBeVisible();
      await parent.getByText('Done (1)', { exact: true }).click();
      await expect(item.locator('time')).toBeVisible();
      await item.getByRole('button', { name: 'Mark not ready', exact: true }).click();
      await expect(parent.getByText('0 of 1 items ready')).toBeVisible();
      await expect(item.locator('time')).toHaveCount(0);
      await expect(item).not.toContainText('Sample Parent');

      const settings = parent.getByRole('form', { name: 'Edit list details' });
      await parent.getByText('List details', { exact: true }).click();
      await settings.getByLabel('Share with family').check();
      await settings.getByRole('button', { name: 'Save list details' }).click();
      await expect(parent.getByText(/Shared with family ·/)).toBeVisible();
      expect((await child.request.get(url.href)).status()).toBe(200);
      await parent.getByText('List details', { exact: true }).click();
      await settings.getByLabel('Archive this list').check();
      await settings.getByRole('button', { name: 'Save list details' }).click();
      await expect(parent.getByText(/· Archived$/)).toBeVisible();
      expect((await child.request.get(url.href)).status()).toBe(404);
      await parent.getByText('List details', { exact: true }).click();
      await settings.getByLabel('Archive this list').uncheck();
      await settings.getByLabel('Share with family').uncheck();
      await settings.getByRole('button', { name: 'Save list details' }).click();
      await expect(add).toBeVisible();
      await expect(parent.getByText(/Parents only ·/)).toBeVisible();
      await expect(item).toBeVisible();
      expect((await child.request.get(url.href)).status()).toBe(404);
    } finally {
      await parentContext.close();
      await childContext.close();
    }
  });
}

test('a rejected item draft cannot overwrite another session’s item edit', async ({ page, browser }) => {
  await signIn(page, 'parent@example.test', 'synthetic-parent-password');
  await page.goto('/lists');
  const create = page.getByRole('form', { name: 'Create a family list' });
  const title = 'Synthetic item conflict ' + Date.now();
  await create.getByLabel('List name').fill(title);
  await create.getByRole('button', { name: 'Create list' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const add = page.getByRole('form', { name: 'Add things to do' });
  await add.getByLabel('Things to add').fill('Canvas bag');
  await add.getByRole('button', { name: 'Add items' }).click();
  const item = page.getByRole('article', { name: 'Canvas bag', exact: true });
  await expect(item).toBeVisible();
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await signIn(other, 'parent@example.test', 'synthetic-parent-password');
    const session = async (view: Page) => (await view.context().cookies()).find(cookie => cookie.name === 'better-auth.session_token')?.value;
    expect(Boolean(await session(page)) && Boolean(await session(other)) && await session(page) !== await session(other)).toBe(true);
    await other.goto(page.url());
    await item.getByText('Edit item', { exact: true }).click();
    await item.getByLabel('Item name').fill('Small bag');
    const otherItem = other.getByRole('article', { name: 'Canvas bag', exact: true });
    await otherItem.getByText('Edit item', { exact: true }).click();
    await otherItem.getByLabel('Item name').fill('Large bag');
    await otherItem.getByRole('button', { name: 'Save item', exact: true }).click();
    await expect(other.getByRole('article', { name: 'Large bag', exact: true })).toBeVisible();
    await item.getByRole('button', { name: 'Save item', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Someone changed this item');
    const currentItem = page.getByRole('article', { name: 'Large bag', exact: true });
    await expect(currentItem.getByLabel('Item name')).toHaveValue('Small bag');
    const retried = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('?/editItem'));
    await currentItem.getByRole('button', { name: 'Save item', exact: true }).click();
    expect((await retried).status()).toBe(409);
    await expect(page.getByRole('alert')).toContainText('Someone changed this item');
    await other.reload();
    await expect(other.getByRole('article', { name: 'Large bag', exact: true })).toBeVisible();
  } finally { await otherContext.close(); }
});

test('early edits and open panels survive checklist detail hydration', async ({ page, browser }) => {
  await signIn(page, 'parent@example.test', 'synthetic-parent-password');
  await page.goto('/lists');
  const create = page.getByRole('form', { name: 'Create a family list' });
  const title = 'Synthetic early edit ' + Date.now();
  await create.getByLabel('List name').fill(title);
  await create.getByRole('button', { name: 'Create list' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const add = page.getByRole('form', { name: 'Add things to do' });
  await add.getByLabel('Things to add').fill('Towels');
  await add.getByRole('button', { name: 'Add items' }).click();
  await expect(page.getByRole('article', { name: 'Towels', exact: true })).toBeVisible();

  const context = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  let release!: () => void, requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const request = new Promise<void>(resolve => { requested = resolve; });
  try {
    const delayed = await context.newPage();
    await delayed.route(url => decodeURIComponent(url.pathname).endsWith('/src/routes/lists/[id]/+page.svelte'), async route => {
      requested();
      await gate;
      await route.continue();
    });
    await delayed.goto(page.url(), { waitUntil: 'commit' });
    await request;
    const main = delayed.getByRole('main');
    await expect(main).toHaveAttribute('data-hydrated', 'false');
    await delayed.getByText('List details', { exact: true }).click();
    await delayed.getByText('Done (0)', { exact: true }).click();
    const settings = delayed.getByRole('form', { name: 'Edit list details' });
    await settings.getByLabel('Description (optional)').fill('New packing notes');
    await settings.getByLabel('Target date (optional)').fill('2099-12-25');
    await settings.getByLabel('Share with family').check();
    await settings.getByLabel('Archive this list').check();
    const item = delayed.getByRole('article', { name: 'Towels', exact: true });
    await item.getByText('Edit item', { exact: true }).click();
    await item.getByLabel('Item name').fill('Beach towels');
    const delayedAdd = delayed.getByRole('form', { name: 'Add things to do' });
    await delayedAdd.getByLabel('Things to add').fill('A spare bag');
    const name = settings.getByLabel('List name');
    await name.selectText();
    release();
    await expect(main).toHaveAttribute('data-hydrated', 'true');
    await expect(name).toBeFocused();
    await name.pressSequentially('Hydrated trip');
    await expect(delayed.getByText('Ready items will appear here.')).toBeVisible();
    await expect(item.getByLabel('Item name')).toHaveValue('Beach towels');
    expect(await delayedAdd.evaluate(element => new FormData(element as HTMLFormElement).get('text'))).toBe('A spare bag');
    expect(await settings.evaluate(element => Object.fromEntries(new FormData(element as HTMLFormElement)))).toMatchObject({
      name: 'Hydrated trip', description: 'New packing notes', targetDate: '2099-12-25', shared: 'yes', archived: 'yes'
    });
    await settings.getByRole('button', { name: 'Save list details' }).click();
    await expect(delayed.getByRole('heading', { name: 'Hydrated trip' })).toBeVisible();
    await expect(delayed.getByText(/Shared with family.*Archived/)).toBeVisible();
  } finally { release(); await context.close(); }
});
