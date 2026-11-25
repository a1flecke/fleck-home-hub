import { expect, test, type Page } from '@playwright/test';

const origin = 'http://127.0.0.1:4173';

async function signIn(page: Page, email: string, password: string, heading: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

function day(page: Page, date: string) {
  return page.getByRole('region', { name: `Chores for ${date}`, exact: true });
}

test('a parent sees the week grouped by child and day, filters it, and adds a one-time chore', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, 'week-parent@example.test', 'synthetic-week-parent-password', 'Hello, Week Parent');
  await page.goto('/chores/week?date=2099-03-02');
  await expect(page.getByRole('heading', { name: 'Chore week' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Chore management' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Previous week' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'This week' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Next week' })).toBeVisible();

  const pending = day(page, '2099-03-02').getByRole('article', { name: 'Week pending chore for Week Kid' });
  await expect(pending).toContainText('Waiting for parent verification');
  await expect(pending).toContainText('$1.00');
  await expect(pending).toContainText('One-time chore');
  const rework = day(page, '2099-03-02').getByRole('article', { name: 'Week rework chore for Week Kid' });
  await expect(rework).toContainText('Needs rework');
  await expect(rework).toContainText('Please put the games away');
  await expect(day(page, '2099-03-03').getByRole('article', { name: 'Week verified chore for Week Sibling' })).toContainText('Verified');

  await page.getByRole('link', { name: 'Week Kid (2)', exact: true }).click();
  await expect(page).toHaveURL(/child=/);
  await expect(day(page, '2099-03-02').getByRole('article', { name: /Week Kid/ })).toHaveCount(2);
  await expect(day(page, '2099-03-03').getByRole('article')).toHaveCount(0);
  await page.getByRole('link', { name: 'Verified (1)', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Week verified chore for Week Sibling' })).toHaveCount(0);
  await page.getByRole('link', { name: 'All statuses (3)', exact: true }).click();
  await expect(page.getByRole('link', { name: 'All children (3)', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Add a chore for 2099-03-05', exact: true }).click();
  const form = page.getByRole('form', { name: 'Add a chore for this week' });
  await expect(form.getByLabel('Due date', { exact: true })).toHaveValue('2099-03-05');
  await expect(form).toBeVisible();
  const title = `Board chore ${testInfo.repeatEachIndex}`;
  await form.getByLabel('Chore title', { exact: true }).fill(title);
  await form.getByLabel('Description (optional)', { exact: true }).fill('Synthetic board description');
  await form.getByRole('combobox', { name: 'Assigned child', exact: true }).selectOption({ label: 'Week Sibling' });
  await form.getByLabel('Reward in dollars', { exact: true }).fill('3.25');
  await form.getByRole('button', { name: 'Add chore', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Chore added');
  const created = day(page, '2099-03-05').getByRole('article', { name: `${title} for Week Sibling` });
  await expect(created).toContainText('Synthetic board description');
  await expect(created).toContainText('$3.25');
  await expect(created).toContainText('To do');
  await expect(created).toContainText('One-time chore');
  await page.screenshot({ path: testInfo.outputPath('chore-week-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('chore-week-desktop.png'), fullPage: true });
});

test('the empty week shows a clear first-chore action and works without JavaScript', async ({ page, browser }, testInfo) => {
  await signIn(page, 'week-empty-parent@example.test', 'synthetic-week-empty-parent-password', 'Hello, Week Empty Parent');
  const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    const native = await context.newPage();
    await native.goto('/chores/week?date=2099-05-02');
    await expect(native.getByRole('heading', { name: 'No chores planned for this week' })).toBeVisible();
    await expect(native.getByRole('link', { name: 'Add the first chore' })).toBeVisible();
    await native.getByRole('link', { name: 'Add the first chore' }).click();
    const form = native.getByRole('form', { name: 'Add a chore for this week' });
    await expect(form).toBeVisible();
    await form.getByLabel('Chore title', { exact: true }).fill('First native board chore');
    await form.getByLabel('Description (optional)', { exact: true }).fill('Typed without JavaScript');
    await form.getByLabel('Due date', { exact: true }).fill('2099-05-02');
    await form.getByRole('button', { name: 'Add chore', exact: true }).click();
    await expect(native.getByRole('status')).toContainText('Chore added');
    await expect(day(native, '2099-05-02').getByRole('article', { name: 'First native board chore for Week Empty Kid' })).toContainText('Typed without JavaScript');
    await native.screenshot({ path: testInfo.outputPath('chore-week-native-empty.png'), fullPage: true });
  } finally { await context.close(); }
});

for (const javaScriptEnabled of [true, false]) {
  test(`invalid quick add keeps its details and week for correction (JavaScript ${javaScriptEnabled ? 'on' : 'off'})`, async ({ page, browser }, testInfo) => {
    await signIn(page, 'week-empty-parent@example.test', 'synthetic-week-empty-parent-password', 'Hello, Week Empty Parent');
    const context = await browser.newContext({ javaScriptEnabled, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
    try {
      const board = await context.newPage();
      await board.goto('/chores/week?date=2099-06-01&add=1');
      const form = board.getByRole('form', { name: 'Add a chore for this week' });
      await expect(form).toBeVisible();
      await form.getByLabel('Chore title', { exact: true }).fill('   ');
      await form.getByLabel('Description (optional)', { exact: true }).fill('Keep this board description');
      await form.getByLabel('Due date', { exact: true }).fill('2099-06-02');
      await form.getByLabel('Reward in dollars', { exact: true }).fill('2.00');
      await form.getByRole('button', { name: 'Add chore', exact: true }).click();
      await expect(board.getByRole('alert')).toContainText('Unable to add chore');
      const corrected = board.getByRole('form', { name: 'Add a chore for this week' });
      await expect(corrected).toBeVisible();
      await expect(corrected.getByRole('textbox', { name: 'Description (optional)', exact: true })).toHaveValue('Keep this board description');
      await expect(corrected.getByLabel('Due date', { exact: true })).toHaveValue('2099-06-02');
      await expect(corrected.getByLabel('Reward in dollars', { exact: true })).toHaveValue('2.00');
      const title = `Corrected board chore ${javaScriptEnabled} ${testInfo.repeatEachIndex}`;
      await corrected.getByLabel('Chore title', { exact: true }).fill(title);
      await corrected.getByRole('button', { name: 'Add chore', exact: true }).click();
      await expect(board.getByRole('status')).toContainText('Chore added');
      await expect(day(board, '2099-06-02').getByRole('article', { name: `${title} for Week Empty Kid` })).toBeVisible();
    } finally { await context.close(); }
  });
}

test('the quick-add form and disclosure survive delayed hydration with an active selection', async ({ page, browser }) => {
  await signIn(page, 'week-parent@example.test', 'synthetic-week-parent-password', 'Hello, Week Parent');
  const context = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const blocked = new Promise<void>(resolve => { requested = resolve; });
  try {
    const delayed = await context.newPage();
    await delayed.route('**/src/routes/chores/week/+page.svelte*', async route => { requested(); await gate; await route.continue(); });
    await delayed.goto('/chores/week?date=2099-03-08&add=1', { waitUntil: 'commit' });
    await blocked;
    const form = delayed.getByRole('form', { name: 'Add a chore for this week' });
    await form.getByLabel('Description (optional)', { exact: true }).fill('Typed before hydration');
    await form.getByRole('combobox', { name: 'Assigned child', exact: true }).selectOption({ label: 'Week Sibling' });
    const siblingId = await form.getByRole('combobox', { name: 'Assigned child', exact: true }).locator('option', { hasText: 'Week Sibling' }).getAttribute('value');
    const title = form.getByLabel('Chore title', { exact: true });
    await title.fill('Before hydration');
    await title.focus();
    await title.evaluate((input: HTMLInputElement) => input.select());
    release();
    await delayed.waitForLoadState('networkidle');
    await delayed.keyboard.insertText('During hydration selection');
    await expect(form).toBeVisible();
    await expect(delayed.locator('details').filter({ has: form })).toHaveAttribute('open', '');
    await expect(form.getByRole('textbox', { name: 'Description (optional)', exact: true })).toHaveValue('Typed before hydration');
    await expect(form.getByRole('combobox', { name: 'Assigned child', exact: true })).toHaveValue(siblingId!);
    expect(await form.evaluate(element => Object.fromEntries(new FormData(element as HTMLFormElement)))).toMatchObject({
      title: 'During hydration selection', description: 'Typed before hydration', dueDate: '2099-03-08', assignee: siblingId!
    });
  } finally { release(); await context.close(); }
});

test('anonymous, child, cross-household and disabled visitors cannot use the parent board', async ({ page, browser }) => {
  const anonymous = await page.request.get('/chores/week', { maxRedirects: 0 });
  expect(anonymous.status()).toBe(303);
  expect(anonymous.headers()['location']).toBe('/sign-in');

  await signIn(page, 'week-kid@example.test', 'synthetic-week-kid-password', "Week Kid's My Day");
  const child = await page.request.get('/chores/week', { maxRedirects: 0 });
  expect(child.status()).toBe(403);

  await page.context().clearCookies();
  await signIn(page, 'week-parent@example.test', 'synthetic-week-parent-password', 'Hello, Week Parent');
  await page.goto('/chores/week?date=2099-03-02');
  await page.getByText('Add a chore for this week', { exact: true }).click();
  const kidId = await page.getByRole('form', { name: 'Add a chore for this week' }).getByRole('combobox', { name: 'Assigned child', exact: true }).locator('option', { hasText: 'Week Kid' }).getAttribute('value');
  const forgedOrigin = await page.request.post('/chores/week?/create', { form: { title: 'Forged week chore', assignee: kidId!, dueDate: '2099-03-02', reward: '1' }, headers: { origin: 'https://attacker.example.test' } });
  expect(forgedOrigin.status()).toBe(403);
  expect((await page.request.get('/chores/week?child=not-a-child', { maxRedirects: 0 })).status()).toBe(400);

  const other = await browser.newContext();
  try {
    const login = await other.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'other-parent@example.test', password: 'synthetic-other-parent-password' } });
    expect(login.status()).toBe(200);
    const own = await other.request.get('/chores/week');
    expect(own.status()).toBe(200);
    expect(await own.text()).not.toContain('Week pending chore');
    const crossHousehold = await other.request.post('/chores/week?/create', { form: { title: 'Cross-household chore', assignee: kidId!, dueDate: '2099-03-02', reward: '1' }, headers: { origin } });
    expect(crossHousehold.status()).toBe(400);
  } finally { await other.close(); }

  const disabled = await browser.newContext();
  try {
    const login = await disabled.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'disabled-expense@example.test', password: 'synthetic-disabled-expense-password' } });
    expect(login.status()).toBe(401);
    expect((await disabled.request.get('/chores/week', { maxRedirects: 0 })).status()).toBe(303);
  } finally { await disabled.close(); }

  const childMutationContext = await browser.newContext();
  try {
    const login = await childMutationContext.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'week-kid@example.test', password: 'synthetic-week-kid-password' } });
    expect(login.status()).toBe(200);
    const childMutation = await childMutationContext.request.post('/chores/week?/create', { form: { title: 'Child forged chore', assignee: kidId!, dueDate: '2099-03-02', reward: '1' }, headers: { origin } });
    expect(childMutation.status()).toBe(403);
  } finally { await childMutationContext.close(); }
  await page.goto('/chores/week?date=2099-03-02');
  await expect(page.getByText('Child forged chore')).toHaveCount(0);
});
