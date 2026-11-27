// e2e-isolation: fresh-households
import { expect, test } from '@playwright/test';
import { freshHousehold, signInAs } from './support/households';
import { hydrated, settle } from './support/navigation';

for (const javaScriptEnabled of [false, true]) {
  test(`grocery edit draft survives concurrent deletion (JavaScript ${javaScriptEnabled ? 'on' : 'off'})`, async ({ browser }) => {
    const household = await freshHousehold({
      name: 'Grocery Draft Recovery Home',
      members: [
        { name: 'Parent A', role: 'parent' },
        { name: 'Parent B', role: 'parent' }
      ]
    });
    const parentA = household.members['Parent A'];
    const parentB = household.members['Parent B'];
    const contextA = await browser.newContext({ javaScriptEnabled, viewport: { width: 375, height: 812 } });
    const contextB = await browser.newContext({ viewport: { width: 375, height: 812 } });
    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      await signInAs(pageA, parentA);
      await signInAs(pageB, parentB);

      await pageA.goto('/groceries');
      const add = pageA.getByRole('form', { name: 'Add grocery item' });
      await add.getByLabel('Item', { exact: true }).fill('Sourdough loaf');
      await add.getByLabel('Quantity', { exact: true }).fill('1');
      await add.getByRole('button', { name: 'Add item' }).click();
      await expect(pageA.getByRole('article').filter({ hasText: 'Sourdough loaf' })).toBeVisible();

      await pageB.goto('/groceries');
      const itemB = pageB.getByRole('article').filter({ hasText: 'Sourdough loaf' });
      await expect(itemB).toBeVisible();

      // Parent A opens Edit and types a draft before Parent B deletes the item.
      const itemA = pageA.getByRole('article').filter({ hasText: 'Sourdough loaf' });
      await itemA.getByText('Edit item', { exact: true }).click();
      const editA = itemA.getByRole('form', { name: 'Edit Sourdough loaf' });
      const initialVersion = await editA.locator('input[name="version"]').inputValue();
      await editA.getByLabel('Item', { exact: true }).fill('Rosemary sourdough');
      await editA.getByLabel('Quantity', { exact: true }).fill('2');

      await itemB.getByRole('button', { name: 'Remove item' }).click();
      await expect(pageB.getByText('Nothing left to buy.')).toBeVisible();

      await editA.getByRole('button', { name: 'Save item' }).click();
      await expect(pageA.getByRole('status').filter({ hasText: 'This item could not be saved.' })).toBeVisible();
      await expect(pageA.getByRole('status').filter({ hasText: 'This item was removed in another session.' })).toBeVisible();

      const recovered = pageA.getByRole('form', { name: 'Edit Rosemary sourdough' });
      await expect(recovered).toBeVisible();
      await expect(recovered.getByLabel('Item', { exact: true })).toHaveValue('Rosemary sourdough');
      await expect(recovered.getByLabel('Quantity', { exact: true })).toHaveValue('2');
      expect(await recovered.locator('input[name="version"]').inputValue()).toBe(initialVersion);

      // Resubmitting unchanged stays rejected and keeps the draft.
      await recovered.getByRole('button', { name: 'Save item' }).click();
      await expect(pageA.getByRole('status').filter({ hasText: 'This item could not be saved.' })).toBeVisible();
      await expect(pageA.getByRole('form', { name: 'Edit Rosemary sourdough' }).getByLabel('Quantity', { exact: true })).toHaveValue('2');
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test(`checklist item edit draft survives concurrent deletion (JavaScript ${javaScriptEnabled ? 'on' : 'off'})`, async ({ browser }) => {
    const household = await freshHousehold({
      name: 'Checklist Draft Recovery Home',
      members: [
        { name: 'Parent A', role: 'parent' },
        { name: 'Parent B', role: 'parent' },
        { name: 'Sam', role: 'kid' }
      ]
    });
    const parentA = household.members['Parent A'];
    const parentB = household.members['Parent B'];
    const contextA = await browser.newContext({ javaScriptEnabled, viewport: { width: 375, height: 812 } });
    const contextB = await browser.newContext({ viewport: { width: 375, height: 812 } });
    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      await signInAs(pageA, parentA);
      await signInAs(pageB, parentB);

      await pageA.goto('/lists');
      const create = pageA.getByRole('form', { name: 'Create a family list' });
      await create.getByLabel('List name').fill('Camping Trip');
      await create.getByRole('button', { name: 'Create list' }).click();
      await expect(pageA.getByRole('heading', { name: 'Camping Trip' })).toBeVisible();
      const listUrl = pageA.url();

      const add = pageA.getByRole('form', { name: 'Add things to do' });
      await add.getByLabel('Things to add').fill('Lantern');
      await add.getByRole('button', { name: 'Add items' }).click();
      const itemA = pageA.getByRole('article', { name: 'Lantern', exact: true });
      await expect(itemA).toBeVisible();

      await pageB.goto(listUrl);
      const itemB = pageB.getByRole('article', { name: 'Lantern', exact: true });
      await expect(itemB).toBeVisible();

      await itemA.getByText('Edit item', { exact: true }).click();
      const editA = itemA.getByRole('form', { name: 'Edit Lantern' });
      const initialVersion = await editA.locator('input[name="version"]').inputValue();
      await editA.getByLabel('Item name').fill('Solar lantern');
      await editA.getByLabel('Assigned to').selectOption({ label: 'Sam' });
      const selectedSam = await editA.getByLabel('Assigned to').inputValue();

      await itemB.getByText('Edit item', { exact: true }).click();
      await itemB.getByRole('button', { name: 'Remove item' }).click();
      await expect(pageB.getByText('No items yet.')).toBeVisible();

      await editA.getByRole('button', { name: 'Save item' }).click();
      await expect(pageA.getByRole('alert')).toContainText('Someone changed this item');

      const removedSection = pageA.getByRole('region', { name: 'Removed item draft' });
      await expect(removedSection).toBeVisible();
      await expect(removedSection).toContainText('This item was removed in another session.');
      const recoveredForm = removedSection.getByRole('form', { name: 'Edit removed item' });
      await expect(recoveredForm.getByLabel('Item name')).toHaveValue('Solar lantern');
      await expect(recoveredForm.getByLabel('Assigned to')).toHaveValue(selectedSam);
      expect(await recoveredForm.locator('input[name="version"]').inputValue()).toBe(initialVersion);

      const retried = pageA.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('?/editItem'));
      await recoveredForm.getByRole('button', { name: 'Save item' }).click();
      expect((await retried).status()).toBe(409);
      await expect(pageA.getByRole('region', { name: 'Removed item draft' }).getByLabel('Item name')).toHaveValue('Solar lantern');
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
}

test('editing a long-running recurring calendar series links to the next occurrence from the viewed date', async ({ browser }) => {
  const household = await freshHousehold({
    name: 'Calendar Saved Elsewhere Home',
    members: [{ name: 'Parent A', role: 'parent' }]
  });
  const parent = household.members['Parent A'];
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  try {
    const page = await context.newPage();
    await signInAs(page, parent);
    const created = await page.request.post('/calendar?/saveEvent', {
      headers: { origin: 'http://127.0.0.1:4173' },
      form: { title: 'Weekly piano', date: '2024-01-01', allDay: 'on', weekday: '1' }
    });
    expect(await created.json()).toMatchObject({ type: 'success', status: 200 });

    // Monday, September 7, 2099: move the recurring series from Monday to Tuesday.
    await page.goto('/calendar?date=2099-09-07&view=day');
    await hydrated(page);
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Weekly piano', exact: true }) });
    await expect(card).toBeVisible();
    await card.getByText('Edit event', { exact: true }).click();
    await card.getByLabel('Monday').uncheck();
    await card.getByLabel('Tuesday').check();
    await card.getByRole('button', { name: 'Save changes' }).click();

    const status = page.getByRole('status');
    await expect(status).toContainText('Event saved.');
    const link = status.getByRole('link', { name: 'Go to Tuesday, September 8, 2099' });
    await expect(link).toBeVisible();
    await link.click();
    await settle(page);
    await expect(page).toHaveURL(/\/calendar\?date=2099-09-08&view=day$/);
    await expect(page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Weekly piano', exact: true }) })).toBeVisible();
  } finally {
    await context.close();
  }
});
