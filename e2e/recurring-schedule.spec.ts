import { expect, test, type Page } from '@playwright/test';
import { hydrated } from './support/navigation';
import { pageModule } from './support/modules';

const origin = 'http://127.0.0.1:4173';

async function signIn(page: Page, email = 'schedule-parent@example.test', password = 'synthetic-schedule-parent-password', heading = 'Hello, Schedule Parent') {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

function article(page: Page, id: string) {
  return page.locator(`#series-${id}`);
}

function form(page: Page, id: string, title: string) {
  return article(page, id).getByRole('form', { name: `Change schedule for ${title}` });
}

test('a parent changes repeat days with a reviewed preview and keeps completed and pending work', async ({ page, browser }, testInfo) => {
  await signIn(page);
  await page.goto('/dashboard');
  const earnings = page.getByRole('article', { name: 'Earnings for Schedule Kid' });
  const owedBefore = await earnings.getByText(/^Verified earnings owed:/).innerText();
  await expect(owedBefore).toContain('$3.00');

  await page.goto('/chores/series?focus=sched-series');
  const series = article(page, 'sched-series');
  await expect(series).toContainText('Monday, Wednesday');
  const edit = form(page, 'sched-series', 'Schedule trash');
  await expect(edit.getByLabel('Effective from')).toHaveValue('2099-03-01');
  await edit.getByLabel('Effective from').fill('2099-03-02');
  for (const day of ['Monday', 'Wednesday']) await edit.getByLabel(day, { exact: true }).uncheck();
  for (const day of ['Tuesday', 'Thursday']) await edit.getByLabel(day, { exact: true }).check();
  await edit.getByRole('button', { name: 'Preview schedule change' }).click();

  const preview = page.getByRole('region', { name: 'Proposed schedule change' });
  await expect(preview).toContainText('Old pattern: Monday and Wednesday');
  await expect(preview).toContainText('New pattern: Tuesday and Thursday');
  await expect(preview).toContainText('First affected date: 2099-03-02');
  await expect(preview).toContainText('Remove old unstarted dates: 2099-03-02');
  await expect(preview).toContainText('Keep submitted or completed: 2099-03-04');
  await expect(preview).toContainText('2099-03-03');
  await expect(preview).toContainText('2099-03-05');
  await page.screenshot({ path: testInfo.outputPath('schedule-preview-mobile.png'), fullPage: true });
  await preview.getByRole('button', { name: 'Save schedule change' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Schedule updated' })).toBeVisible();
  await expect(article(page, 'sched-series')).toContainText('Tuesday, Thursday');
  await expect(article(page, 'sched-series')).toContainText('Effective from 2099-03-02');

  await page.goto('/dashboard');
  await expect(page.getByRole('article', { name: 'Earnings for Schedule Kid' }).getByText(/^Verified earnings owed:/)).toHaveText(owedBefore);

  await page.goto('/chores/week?date=2099-03-02');
  await expect(page.getByRole('region', { name: 'Chores for 2099-03-03', exact: true }).getByRole('article', { name: 'Schedule trash for Schedule Kid' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Chores for 2099-03-04', exact: true }).getByRole('article', { name: 'Schedule trash for Schedule Kid' })).toContainText('Waiting for parent verification');
  await expect(page.getByRole('region', { name: 'Chores for 2099-03-05', exact: true }).getByRole('article', { name: 'Schedule trash for Schedule Kid' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Chores for 2099-03-02', exact: true }).getByText('Schedule trash')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('schedule-board-mobile.png'), fullPage: true });

  const child = await browser.newContext();
  try {
    const login = await child.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'schedule-kid@example.test', password: 'synthetic-schedule-kid-password' } });
    expect(login.status()).toBe(200);
    const history = await child.request.get('/chores/history?scope=later');
    const text = await history.text();
    expect(text).toContain('2099-03-03');
    expect(text).not.toContain('2099-03-02');
  } finally { await child.close(); }
});

for (const javaScriptEnabled of [true, false]) {
  test(`a rejected schedule preview keeps its fields for correction (JavaScript ${javaScriptEnabled ? 'on' : 'off'})`, async ({ page, browser }) => {
    await signIn(page);
    const context = await browser.newContext({ javaScriptEnabled, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
    try {
      const board = await context.newPage();
      await board.goto('/chores/series?focus=sched-recovery');
      const edit = form(board, 'sched-recovery', 'Schedule recovery');
      await edit.getByRole('textbox', { name: 'Recurring chore title', exact: true }).fill('Keep schedule title');
      await edit.getByRole('textbox', { name: 'Description (optional)', exact: true }).fill('Keep schedule description');
      await edit.getByLabel('Effective from').fill('2099-04-06');
      await edit.getByLabel('Ends on (optional)').fill('2099-04-01');
      await edit.getByRole('button', { name: 'Preview schedule change' }).click();
      await expect(board.getByRole('alert')).toContainText('Unable to use this schedule');
      const corrected = form(board, 'sched-recovery', 'Schedule recovery');
      await expect(corrected.getByRole('textbox', { name: 'Recurring chore title', exact: true })).toHaveValue('Keep schedule title');
      await expect(corrected.getByRole('textbox', { name: 'Description (optional)', exact: true })).toHaveValue('Keep schedule description');
      await expect(corrected.getByLabel('Effective from')).toHaveValue('2099-04-06');
      await expect(corrected.getByLabel('Ends on (optional)')).toHaveValue('2099-04-01');
      await corrected.getByLabel('Ends on (optional)').fill('2099-04-30');
      await corrected.getByRole('button', { name: 'Preview schedule change' }).click();
      const preview = board.getByRole('region', { name: 'Proposed schedule change' });
      await expect(preview).toContainText('New pattern: Monday through 2099-04-30');
      await expect(preview.getByRole('link', { name: 'Cancel preview' })).toBeVisible();
    } finally { await context.close(); }
  });
}

test('a stale preview cannot overwrite another parent’s schedule revision', async ({ page, browser }) => {
  await signIn(page);
  await page.goto('/chores/series?focus=sched-stale');
  const edit = form(page, 'sched-stale', 'Schedule stale base');
  const updatedAt = await edit.locator('input[name="updatedAt"]').inputValue();
  await edit.getByLabel('Effective from').fill('2099-05-04');
  await edit.getByLabel('Monday', { exact: true }).uncheck();
  await edit.getByLabel('Tuesday', { exact: true }).check();
  await edit.getByRole('button', { name: 'Preview schedule change' }).click();
  await expect(page.getByRole('region', { name: 'Proposed schedule change' })).toBeVisible();

  const second = await browser.newContext();
  try {
    const login = await second.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'schedule-parent-two@example.test', password: 'synthetic-schedule-parent-two-password' } });
    expect(login.status()).toBe(200);
    const competing = await second.request.post('/chores/series?/reviseSchedule&page=1', {
      form: { id: 'sched-stale', updatedAt, title: 'Schedule parent two', description: '', assignee: (await edit.getByRole('combobox', { name: 'Recurring assigned child', exact: true }).inputValue()), effectiveDate: '2099-05-04', endDate: '', weekday: '2', reward: '1.75' },
      headers: { origin }, maxRedirects: 0
    });
    expect(competing.status()).toBe(200);
    expect(await competing.json()).toMatchObject({ type: 'redirect', status: 303 });
  } finally { await second.close(); }

  await page.getByRole('region', { name: 'Proposed schedule change' }).getByRole('button', { name: 'Save schedule change' }).click();
  await expect(page.getByRole('alert')).toContainText('changed in another view');
  await expect(page.getByRole('article').filter({ hasText: 'Schedule parent two' })).toBeVisible();
});

test('the schedule preview and confirmation work without JavaScript', async ({ page, browser }) => {
  await signIn(page);
  const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    const native = await context.newPage();
    await native.goto('/chores/series?focus=sched-native');
    const edit = form(native, 'sched-native', 'Schedule native');
    await edit.getByLabel('Effective from').fill('2099-06-02');
    await edit.getByLabel('Monday', { exact: true }).uncheck();
    await edit.getByLabel('Wednesday', { exact: true }).check();
    await edit.getByRole('button', { name: 'Preview schedule change' }).click();
    const preview = native.getByRole('region', { name: 'Proposed schedule change' });
    await expect(preview).toContainText('New pattern: Wednesday');
    await preview.getByRole('button', { name: 'Save schedule change' }).click();
    await expect(native.getByRole('status').filter({ hasText: 'Schedule updated' })).toBeVisible();
    await expect(article(native, 'sched-native')).toContainText('Wednesday');
    await expect(article(native, 'sched-native')).toContainText('Effective from 2099-06-02');
  } finally { await context.close(); }
});

test('schedule edits and repeat-day selections survive delayed hydration', async ({ page, browser }) => {
  await signIn(page);
  const context = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const blocked = new Promise<void>(resolve => { requested = resolve; });
  try {
    const delayed = await context.newPage();
    await delayed.route(pageModule('chores/series'), async route => { requested(); await gate; await route.continue(); });
    await delayed.goto('/chores/series?focus=sched-hydration', { waitUntil: 'commit' });
    await blocked;
    const edit = form(delayed, 'sched-hydration', 'Schedule hydration');
    await edit.getByLabel('Effective from').fill('2099-07-07');
    await edit.getByLabel('Monday', { exact: true }).uncheck();
    await edit.getByLabel('Tuesday', { exact: true }).check();
    await edit.getByRole('textbox', { name: 'Description (optional)', exact: true }).fill('Hydrated schedule description');
    const title = edit.getByRole('textbox', { name: 'Recurring chore title', exact: true });
    await title.fill('Before schedule hydration');
    await title.focus();
    await title.evaluate((input: HTMLInputElement) => input.select());
    release();
    await hydrated(delayed);
    await delayed.keyboard.insertText('After schedule hydration');
    await expect(article(delayed, 'sched-hydration').locator('details').first()).toHaveAttribute('open', '');
    await expect(edit.getByRole('textbox', { name: 'Description (optional)', exact: true })).toHaveValue('Hydrated schedule description');
    await expect(edit.getByLabel('Effective from')).toHaveValue('2099-07-07');
    expect(await edit.evaluate(element => Object.fromEntries(new FormData(element as HTMLFormElement)))).toMatchObject({
      title: 'After schedule hydration', effectiveDate: '2099-07-07', weekday: '2'
    });
  } finally { release(); await context.close(); }
});

test('schedule revisions reject child, cross-household, disabled and cross-origin requests and hide ended series', async ({ page, browser }) => {
  const anonymous = await page.request.get('/chores/series', { maxRedirects: 0 });
  expect(anonymous.status()).toBe(303);
  const child = await browser.newContext();
  try {
    const login = await child.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'schedule-kid@example.test', password: 'synthetic-schedule-kid-password' } });
    expect(login.status()).toBe(200);
    expect((await child.request.get('/chores/series', { maxRedirects: 0 })).status()).toBe(403);
    expect((await child.request.post('/chores/series?/reviseSchedule&page=1', { form: { id: 'sched-native', updatedAt: 'x', title: 'Child change', effectiveDate: '2099-06-02', weekday: '3' }, headers: { origin } })).status()).toBe(403);
  } finally { await child.close(); }

  await signIn(page);
  await page.goto('/chores/series?focus=sched-ended');
  await expect(article(page, 'sched-ended').getByText('Change schedule', { exact: true })).toHaveCount(0);
  await page.goto('/chores/series?focus=sched-paused');
  const paused = form(page, 'sched-paused', 'Schedule paused');
  await paused.getByLabel('Effective from').fill('2099-08-02');
  await paused.getByLabel('Tuesday', { exact: true }).check();
  await paused.getByRole('button', { name: 'Preview schedule change' }).click();
  await expect(page.getByRole('region', { name: 'Proposed schedule change' })).toContainText('This series is paused.');

  const other = await browser.newContext();
  try {
    const login = await other.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'other-parent@example.test', password: 'synthetic-other-parent-password' } });
    expect(login.status()).toBe(200);
    const cross = await other.request.post('/chores/series?/reviseSchedule&page=1', { form: { id: 'sched-native', updatedAt: 'x', title: 'Cross change', effectiveDate: '2099-06-02', weekday: '3' }, headers: { origin } });
    expect(cross.status()).toBe(400);
  } finally { await other.close(); }

  const forged = await page.request.post('/chores/series?/reviseSchedule&page=1', { form: { id: 'sched-native', updatedAt: 'x', title: 'Forged', effectiveDate: '2099-06-02', weekday: '3' }, headers: { origin: 'https://attacker.example.test' } });
  expect(forged.status()).toBe(403);

  const disabled = await browser.newContext();
  try {
    const login = await disabled.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'disabled-expense@example.test', password: 'synthetic-disabled-expense-password' } });
    expect(login.status()).toBe(401);
    expect((await disabled.request.get('/chores/series', { maxRedirects: 0 })).status()).toBe(303);
  } finally { await disabled.close(); }
});
