import { expect, test, type Page } from '@playwright/test';
import { hydrated, settle } from './support/navigation';

const origin = 'http://127.0.0.1:4173';

async function signIn(page: Page, email = 'week-parent@example.test', password = 'synthetic-week-parent-password', heading = 'Hello, Week Parent') {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

function day(page: Page, date: string) {
  return page.getByRole('region', { name: `Chores for ${date}`, exact: true });
}

async function createChore(page: Page, title: string, dueDate: string, assignee = 'Week Kid') {
  await page.goto(`/chores/week?date=${dueDate}&add=1`);
  const form = page.getByRole('form', { name: 'Add a chore for this week' });
  await form.getByLabel('Chore title', { exact: true }).fill(title);
  await form.getByLabel('Description (optional)', { exact: true }).fill('Original edit description');
  await form.getByRole('combobox', { name: 'Assigned child', exact: true }).selectOption({ label: assignee });
  await form.getByLabel('Due date', { exact: true }).fill(dueDate);
  await form.getByLabel('Reward in dollars', { exact: true }).fill('2.00');
  await form.getByRole('button', { name: 'Add chore', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Chore added');
  return day(page, dueDate).getByRole('article', { name: `${title} for ${assignee}` });
}

test('a parent corrects an unstarted chore and cancels an unwanted one without deleting history', async ({ page, browser }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  const title = `Edit journey ${testInfo.repeatEachIndex}`;
  let article = await createChore(page, title, '2099-03-12');
  const choreId = await article.locator('form[aria-label^="Edit "] input[name="id"]').inputValue();

  await article.getByText('Edit chore', { exact: true }).click();
  const edit = article.getByRole('form', { name: `Edit ${title}` });
  await expect(edit.getByLabel('Chore title', { exact: true })).toHaveValue(title);
  await expect(edit.getByLabel('Due date', { exact: true })).toHaveValue('2099-03-12');
  await expect(edit.getByLabel('Reward in dollars', { exact: true })).toHaveValue('2.00');
  await edit.getByLabel('Chore title', { exact: true }).fill(`${title} corrected`);
  await edit.getByLabel('Description (optional)', { exact: true }).fill('Corrected edit description');
  await edit.getByRole('combobox', { name: 'Assigned child', exact: true }).selectOption({ label: 'Week Sibling' });
  await edit.getByLabel('Due date', { exact: true }).fill('2099-03-13');
  await edit.getByLabel('Reward in dollars', { exact: true }).fill('4.50');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toContainText('Chore updated');
  await expect(page.getByRole('article', { name: `${title} corrected for Week Sibling` })).toContainText('Corrected edit description');
  await expect(day(page, '2099-03-12').getByText(title, { exact: true })).toHaveCount(0);
  article = day(page, '2099-03-13').getByRole('article', { name: `${title} corrected for Week Sibling` });
  await expect(article).toContainText('$4.50');
  await page.screenshot({ path: testInfo.outputPath('chore-edit-mobile.png'), fullPage: true });

  await article.getByText('Cancel chore…', { exact: true }).click();
  const cancel = article.getByRole('form', { name: `Cancel ${title} corrected` });
  const missingConfirm = await page.request.post(`/chores/week?/cancel&week=2099-03-08`, { form: { id: choreId, updatedAt: await cancel.locator('input[name="updatedAt"]').inputValue() }, headers: { origin } });
  expect(missingConfirm.status()).toBe(400);
  await cancel.getByLabel('I understand this chore will be cancelled').check();
  await cancel.getByRole('button', { name: 'Cancel this chore' }).click();
  await expect(page.getByRole('status')).toContainText('Chore cancelled');
  await expect(page.getByRole('article', { name: `${title} corrected for Week Sibling` })).toHaveCount(0);

  await page.goto('/chores/week?date=2099-03-02');
  await expect(page.getByRole('article', { name: 'Week verified chore for Week Sibling' })).toContainText('$2.00');

  const child = await browser.newContext();
  try {
    const login = await child.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'week-kid@example.test', password: 'synthetic-week-kid-password' } });
    expect(login.status()).toBe(200);
    const submit = await child.request.post('/dashboard?/transition', { form: { id: choreId, action: 'submit' }, headers: { origin } });
    expect(submit.status()).toBe(400);
    const childEdit = await child.request.post('/chores/week?/edit', { form: { id: choreId, updatedAt: 'x', title: 'Child edit', assignee: 'x', dueDate: '2099-03-12' }, headers: { origin } });
    expect(childEdit.status()).toBe(403);
  } finally { await child.close(); }
});

for (const javaScriptEnabled of [true, false]) {
  test(`a rejected edit stays open with its details and can be corrected (JavaScript ${javaScriptEnabled ? 'on' : 'off'})`, async ({ page, browser }, testInfo) => {
    await signIn(page);
    const context = await browser.newContext({ javaScriptEnabled, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
    try {
      const board = await context.newPage();
      const title = `Rejected edit ${javaScriptEnabled} ${testInfo.repeatEachIndex}`;
      let article = await createChore(board, title, javaScriptEnabled ? '2099-04-07' : '2099-04-08');
      await article.getByText('Edit chore', { exact: true }).click();
      let form = article.getByRole('form', { name: `Edit ${title}` });
      await form.getByLabel('Chore title', { exact: true }).fill('   ');
      await form.getByRole('textbox', { name: 'Description (optional)', exact: true }).fill('Keep corrected description');
      await form.getByRole('combobox', { name: 'Assigned child', exact: true }).selectOption({ label: 'Week Sibling' });
      await form.getByLabel('Due date', { exact: true }).fill('2099-04-09');
      await form.getByLabel('Reward in dollars', { exact: true }).fill('3.10');
      await form.getByRole('button', { name: 'Save changes' }).click();
      await expect(board.getByRole('alert')).toContainText('Unable to change this chore');
      form = board.getByRole('form', { name: `Edit ${title}` });
      await expect(form).toBeVisible();
      const siblingId = await form.getByRole('combobox', { name: 'Assigned child', exact: true }).locator('option', { hasText: 'Week Sibling' }).getAttribute('value');
      await expect(form.getByRole('textbox', { name: 'Description (optional)', exact: true })).toHaveValue('Keep corrected description');
      await expect(form.getByRole('combobox', { name: 'Assigned child', exact: true })).toHaveValue(siblingId!);
      await expect(form.getByLabel('Due date', { exact: true })).toHaveValue('2099-04-09');
      await expect(form.getByLabel('Reward in dollars', { exact: true })).toHaveValue('3.10');
      const corrected = `${title} corrected`;
      await form.getByLabel('Chore title', { exact: true }).fill(corrected);
      await form.getByRole('button', { name: 'Save changes' }).click();
      await expect(board.getByRole('status')).toContainText('Chore updated');
      article = day(board, '2099-04-09').getByRole('article', { name: `${corrected} for Week Sibling` });
      await expect(article).toContainText('Keep corrected description');
      await expect(article).toContainText('$3.10');
    } finally { await context.close(); }
  });
}

test('a stale edit from one parent cannot overwrite another parent’s newer work', async ({ page, browser }) => {
  await signIn(page);
  const title = `Stale edit base`;
  const article = await createChore(page, title, '2099-05-04');
  await article.getByText('Edit chore', { exact: true }).click();
  const form = article.getByRole('form', { name: `Edit ${title}` });
  const id = await form.locator('input[name="id"]').inputValue();
  const updatedAt = await form.locator('input[name="updatedAt"]').inputValue();
  const assignee = await form.getByRole('combobox', { name: 'Assigned child', exact: true }).inputValue();

  const second = await browser.newContext();
  try {
    const login = await second.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'week-parent-two@example.test', password: 'synthetic-week-parent-two-password' } });
    expect(login.status()).toBe(200);
    const competing = await second.request.post('/chores/week?/edit&week=2099-05-03', {
      form: { id, updatedAt, title: 'Parent two newer version', description: 'Newer description', assignee, dueDate: '2099-05-04', reward: '2.00' },
      headers: { origin }, maxRedirects: 0
    });
    expect(competing.status()).toBe(200);
    expect(await competing.json()).toMatchObject({ type: 'redirect', status: 303 });
  } finally { await second.close(); }

  await form.getByLabel('Chore title', { exact: true }).fill('Stale parent version');
  await form.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('alert')).toContainText('changed in another view');
  await expect(page.getByRole('article', { name: 'Parent two newer version for Week Kid' })).toContainText('Newer description');
  await expect(page.getByText('Stale parent version')).toHaveCount(0);
});

test('recurring occurrences are managed through their schedule, not as detached one-offs', async ({ page }) => {
  await signIn(page);
  await page.goto('/chores/week?date=2099-03-09');
  const article = page.getByRole('article', { name: 'Week repeating chore for Week Kid' });
  await expect(article).toContainText('Repeating chore');
  await expect(article.getByText('Edit chore', { exact: true })).toHaveCount(0);
  await expect(article.getByText('Cancel chore…', { exact: true })).toHaveCount(0);
  await expect(article.getByRole('link', { name: 'Manage repeating schedule' })).toBeVisible();
});

test('edit and cancel reject child, cross-household and cross-origin requests', async ({ page, browser }) => {
  await signIn(page);
  await page.goto('/chores/week?date=2099-04-06');
  const article = page.getByRole('article', { name: 'Week hydration chore for Week Kid' });
  await article.getByText('Edit chore', { exact: true }).click();
  const form = article.getByRole('form', { name: 'Edit Week hydration chore' });
  const id = await form.locator('input[name="id"]').inputValue();
  const updatedAt = await form.locator('input[name="updatedAt"]').inputValue();
  const assignee = await form.getByRole('combobox', { name: 'Assigned child', exact: true }).inputValue();
  const forged = await page.request.post('/chores/week?/edit&week=2099-04-05', {
    form: { id, updatedAt, title: 'Forged origin edit', description: '', assignee, dueDate: '2099-04-06', reward: '' },
    headers: { origin: 'https://attacker.example.test' }
  });
  expect(forged.status()).toBe(403);

  const other = await browser.newContext();
  try {
    const login = await other.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'other-parent@example.test', password: 'synthetic-other-parent-password' } });
    expect(login.status()).toBe(200);
    const cross = await other.request.post('/chores/week?/edit&week=2099-04-05', {
      form: { id, updatedAt, title: 'Cross household edit', description: '', assignee, dueDate: '2099-04-06', reward: '' }, headers: { origin }
    });
    expect(cross.status()).toBe(400);
  } finally { await other.close(); }

  const verifiedEdit = await page.request.post('/chores/week?/edit&week=2099-03-01', {
    form: { id: 'week-verified', updatedAt: 'stale', title: 'Edit verified', description: '', assignee, dueDate: '2099-03-03', reward: '2.00' }, headers: { origin }
  });
  expect(verifiedEdit.status()).toBe(400);
  const verifiedCancel = await page.request.post('/chores/week?/cancel&week=2099-03-01', { form: { id: 'week-verified', updatedAt: 'stale', confirm: 'yes' }, headers: { origin } });
  expect(verifiedCancel.status()).toBe(400);
  await page.goto('/chores/week?date=2099-03-02');
  await expect(page.getByRole('article', { name: 'Week verified chore for Week Sibling' })).toContainText('$2.00');
});

test('edit form edits, disclosure and active selection survive delayed hydration', async ({ page, browser }) => {
  await signIn(page);
  const context = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const blocked = new Promise<void>(resolve => { requested = resolve; });
  try {
    const delayed = await context.newPage();
    await delayed.route('**/src/routes/chores/week/+page.svelte*', async route => { requested(); await gate; await route.continue(); });
    await delayed.goto('/chores/week?date=2099-04-06', { waitUntil: 'commit' });
    await blocked;
    const article = delayed.getByRole('article', { name: 'Week hydration chore for Week Kid' });
    await article.getByText('Edit chore', { exact: true }).click();
    const form = article.getByRole('form', { name: 'Edit Week hydration chore' });
    await form.getByRole('textbox', { name: 'Description (optional)', exact: true }).fill('Typed edit before hydration');
    await form.getByRole('combobox', { name: 'Assigned child', exact: true }).selectOption({ label: 'Week Sibling' });
    const siblingId = await form.getByRole('combobox', { name: 'Assigned child', exact: true }).locator('option', { hasText: 'Week Sibling' }).getAttribute('value');
    const title = form.getByLabel('Chore title', { exact: true });
    await title.fill('Before edit hydration');
    await title.focus();
    await title.evaluate((input: HTMLInputElement) => input.select());
    release();
    await hydrated(delayed);
    await delayed.keyboard.insertText('After edit hydration');
    await expect(form).toBeVisible();
    await expect(article.locator('details').first()).toHaveAttribute('open', '');
    await expect(form.getByRole('textbox', { name: 'Description (optional)', exact: true })).toHaveValue('Typed edit before hydration');
    await expect(form.getByRole('combobox', { name: 'Assigned child', exact: true })).toHaveValue(siblingId!);
    expect(await form.evaluate(element => Object.fromEntries(new FormData(element as HTMLFormElement)))).toMatchObject({
      title: 'After edit hydration', description: 'Typed edit before hydration', dueDate: '2099-04-06', assignee: siblingId!
    });
  } finally { release(); await context.close(); }
});

test('editing a chore to another week and child navigates to its new context, and jump-to-date preserves filters', async ({ page }, testInfo) => {
  await signIn(page);
  const title = `Context move chore ${testInfo.repeatEachIndex} ${Date.now()}`;
  await createChore(page, title, '2099-06-10', 'Week Kid');

  await page.getByRole('link', { name: /^Week Kid \(/ }).click();
  await settle(page);
  await page.getByRole('link', { name: /^To do \(/ }).click();
  await settle(page);
  await expect(page).toHaveURL(/child=/);
  await expect(page).toHaveURL(/status=todo/);

  const jumpForm = page.getByRole('form', { name: 'Jump to a chore week' });
  await jumpForm.getByLabel('Jump to a date').fill('2099-06-11');
  await jumpForm.getByRole('button', { name: 'Show week' }).click();
  await settle(page);
  await expect(page).toHaveURL(/child=/);
  await expect(page).toHaveURL(/status=todo/);

  const article = day(page, '2099-06-10').getByRole('article', { name: `${title} for Week Kid` });
  await article.getByText('Edit chore', { exact: true }).click();
  const edit = article.getByRole('form', { name: `Edit ${title}` });
  await edit.getByRole('combobox', { name: 'Assigned child', exact: true }).selectOption({ label: 'Week Sibling' });
  await edit.getByLabel('Due date', { exact: true }).fill('2099-06-18');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toContainText('Chore updated');
  await expect(page).toHaveURL(/week=2099-06-14/);
  await expect(page).toHaveURL(/status=todo/);
  await expect(day(page, '2099-06-18').getByRole('article', { name: `${title} for Week Sibling` })).toBeVisible();
});
