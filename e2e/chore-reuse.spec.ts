import { expect, test, type Page, type Route } from '@playwright/test';
import { freshHousehold, signInAs, type SeededHousehold, type SeededMember } from './support/households';
import { hydrated, settle } from './support/navigation';
import { pageModule } from './support/modules';

// e2e-isolation: fresh-households
// Every test builds its own reuse household, so exact balances and reused titles hold on repeat.

const origin = 'http://127.0.0.1:4173';

/** Two parents, three children and five real source chores; "Clean bedroom" was verified for $2.00. */
function reuseHousehold(): Promise<SeededHousehold> {
  return freshHousehold({
    name: 'Reuse household',
    members: [
      { name: 'Reuse Parent', role: 'parent' }, { name: 'Reuse Parent Two', role: 'parent' },
      { name: 'Reuse Kid One', role: 'kid' }, { name: 'Reuse Kid Two', role: 'kid' }, { name: 'Reuse Kid Three', role: 'kid' },
      { name: 'Disabled Reuse Parent', role: 'parent', disabled: true }
    ],
    chores: [
      { key: 'clean', assignee: 'Reuse Kid One', title: 'Clean bedroom', description: 'Vacuum and dust', dueDate: '2099-01-15', rewardCents: 200, status: 'verified' },
      { key: 'plants', assignee: 'Reuse Kid Two', title: 'Water plants', description: 'Kitchen and porch', dueDate: '2099-01-16', rewardCents: 100 },
      { key: 'stale', assignee: 'Reuse Kid One', title: 'Stale source chore', description: 'Changing source', dueDate: '2099-01-17', rewardCents: 50 },
      { key: 'native', assignee: 'Reuse Kid One', title: 'Native reuse chore', description: 'Native description', dueDate: '2099-01-18', rewardCents: 75 },
      { key: 'hydration', assignee: 'Reuse Kid One', title: 'Hydration reuse chore', description: 'Hydration description', dueDate: '2099-01-19', rewardCents: 125 }
    ]
  });
}

/** Signs in through the form, as a family member would. */
async function signIn(page: Page, member: SeededMember) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(member.email);
  await page.getByLabel('Password').fill(member.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: member.role === 'parent' ? `Hello, ${member.name}` : `${member.name}'s My Day` })).toBeVisible();
}

/** Signs in through the API for tests whose subject is not authentication. */
async function signInParent(page: Page, household: SeededHousehold) {
  await signInAs(page, household.members['Reuse Parent']);
}

async function chooseSource(page: Page, title: string) {
  await page.goto('/chores/week/again?date=2099-10-04');
  await page.getByLabel('Search recent chores').fill(title);
  await page.getByRole('button', { name: 'Search' }).click();
  await settle(page);
  const result = page.getByRole('article').filter({ hasText: title });
  await expect(result).toBeVisible();
  await result.getByRole('link', { name: 'Use this chore' }).click();
  await settle(result);
  await expect(page.getByRole('region', { name: 'Selected chore' })).toContainText(title);
}

test('a parent reuses a chore for several children, each works independently, and one verification creates one credit', async ({ page, browser }, testInfo) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const household = await reuseHousehold();
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, household.members['Reuse Parent']);
  await page.goto('/dashboard');
  const kidOneEarnings = page.getByRole('article', { name: 'Earnings for Reuse Kid One' });
  await expect(kidOneEarnings.getByText(/^Verified earnings owed:/)).toHaveText('Verified earnings owed: $2.00');
  await expect(page.getByRole('article', { name: 'Earnings for Reuse Kid Two' }).getByText(/^Verified earnings owed:/)).toHaveText('Verified earnings owed: $0.00');
  await expect(page.getByRole('article', { name: 'Earnings for Reuse Kid Three' }).getByText(/^Verified earnings owed:/)).toHaveText('Verified earnings owed: $0.00');

  const searchPage = `/chores/week/again?date=${today}`;
  await page.goto(searchPage);
  const search = page.getByRole('form', { name: 'Find a recent chore', exact: true });
  const query = search.getByRole('textbox', { name: 'Search recent chores', exact: true });
  const submit = search.getByRole('button', { name: 'Search', exact: true });
  await query.fill('no such household chore');
  await submit.click();
  await expect(page.getByRole('heading', { name: 'No chores match this search', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Clear search', exact: true }).click();
  await settle(page);
  await expect(page).toHaveURL(origin + searchPage);
  await expect(query).toHaveValue('');

  const sourceTitle = 'Clean bedroom';
  await query.fill(sourceTitle);
  await submit.click();
  await expect(page).toHaveURL(url => url.searchParams.get('q') === sourceTitle && url.searchParams.get('date') === today);
  const result = page.getByRole('article').filter({ has: page.getByRole('heading', { name: sourceTitle, exact: true }) });
  await result.getByRole('link', { name: 'Use this chore', exact: true }).click();
  await settle(result);
  const form = page.getByRole('form', { name: 'Assign Clean bedroom again' });
  await expect(form.getByLabel('Chore title', { exact: true })).toHaveValue('Clean bedroom');
  await expect(form.getByRole('textbox', { name: 'Description (optional)', exact: true })).toHaveValue('Vacuum and dust');
  await expect(form.getByLabel('Reward in dollars', { exact: true })).toHaveValue('2.00');
  const title = `Clean bedroom fall ${testInfo.repeatEachIndex}`;
  await form.getByLabel('Chore title', { exact: true }).fill(title);
  await form.getByRole('textbox', { name: 'Description (optional)', exact: true }).fill('Fall deep clean');
  await form.getByLabel('Date', { exact: true }).fill(today);
  await form.getByLabel('Reward in dollars', { exact: true }).fill('2.50');
  for (const child of ['Reuse Kid One', 'Reuse Kid Two', 'Reuse Kid Three']) {
    await expect(form.getByRole('checkbox', { name: child })).toBeChecked();
  }
  await form.getByRole('button', { name: 'Review assignments' }).click();
  const preview = page.getByRole('region', { name: 'Assignment preview' });
  await expect(preview.getByRole('heading', { name: '3 assignments ready' })).toBeVisible();
  for (const child of ['Reuse Kid One', 'Reuse Kid Two', 'Reuse Kid Three']) await expect(preview).toContainText(child);
  await expect(preview).toContainText(today);
  await expect(preview).toContainText(title);
  await expect(preview).toContainText('$2.50');
  await page.screenshot({ path: testInfo.outputPath('chore-reuse-preview-mobile.png'), fullPage: true });
  await preview.getByRole('button', { name: 'Create 3 assignments' }).click();
  await expect(page.getByRole('status').filter({ hasText: '3 chores were assigned' })).toBeVisible();
  const day = page.getByRole('region', { name: `Chores for ${today}`, exact: true });
  await expect(day.getByRole('article', { name: new RegExp(`^${title} for Reuse Kid`) })).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('chore-reuse-board-mobile.png'), fullPage: true });

  for (const name of ['Reuse Kid One', 'Reuse Kid Two', 'Reuse Kid Three']) {
    const childContext = await browser.newContext();
    try {
      const child = await childContext.newPage();
      await signIn(child, household.members[name]);
      await child.goto('/chores/history?scope=today');
      await expect(child.getByRole('article').filter({ hasText: title })).toHaveCount(1);
    } finally { await childContext.close(); }
  }

  const childOne = await browser.newContext();
  try {
    const child = await childOne.newPage();
    await signIn(child, household.members['Reuse Kid One']);
    await child.goto('/chores/history?scope=today');
    const article = child.getByRole('article').filter({ hasText: title });
    await article.getByRole('button', { name: 'Mark complete' }).click();
    await expect(child.getByText('Nice job! Waiting for a parent to check.')).toBeVisible();
  } finally { await childOne.close(); }

  await page.goto('/verify');
  const review = page.getByRole('article', { name: `Review ${title}` });
  await review.getByRole('button', { name: 'Verify and record $2.50' }).click();
  await expect(page.getByRole('status')).toContainText('Chore verified');
  await page.goto('/dashboard');
  await expect(page.getByRole('article', { name: 'Earnings for Reuse Kid One' }).getByText(/^Verified earnings owed:/)).toHaveText('Verified earnings owed: $4.50');
  await expect(page.getByRole('article', { name: 'Earnings for Reuse Kid Two' }).getByText(/^Verified earnings owed:/)).toHaveText('Verified earnings owed: $0.00');
  await expect(page.getByRole('article', { name: 'Earnings for Reuse Kid Three' }).getByText(/^Verified earnings owed:/)).toHaveText('Verified earnings owed: $0.00');
});

test('a repeated batch request creates one set of assignments', async ({ page }) => {
  await signInParent(page, await reuseHousehold());
  await chooseSource(page, 'Water plants');
  const form = page.getByRole('form', { name: 'Assign Water plants again' });
  const sourceId = await form.locator('input[name="sourceId"]').inputValue();
  const sourceUpdatedAt = await form.locator('input[name="sourceUpdatedAt"]').inputValue();
  const submissionKey = await form.locator('input[name="submissionKey"]').inputValue();
  const kidTwo = await form.getByRole('checkbox', { name: 'Reuse Kid Two' }).getAttribute('value');
  await form.getByRole('checkbox', { name: 'Reuse Kid One' }).uncheck();
  await form.getByRole('checkbox', { name: 'Reuse Kid Three' }).uncheck();
  const title = 'Idempotent water plants';
  await form.getByLabel('Chore title', { exact: true }).fill(title);
  await form.getByLabel('Date', { exact: true }).fill('2099-11-01');
  const body = { sourceId, sourceUpdatedAt, submissionKey, title, description: 'Kitchen and porch', dueDate: '2099-11-01', reward: '1.00', assignee: kidTwo! };
  const first = await page.request.post(`/chores/week/again?/create`, { form: body, headers: { origin }, maxRedirects: 0 });
  expect(first.status()).toBe(200);
  expect(await first.json()).toMatchObject({ type: 'redirect', status: 303 });
  const retry = await page.request.post(`/chores/week/again?/create`, { form: body, headers: { origin }, maxRedirects: 0 });
  expect(retry.status()).toBe(200);
  expect(await retry.json()).toMatchObject({ type: 'redirect', status: 303 });
  const conflict = await page.request.post(`/chores/week/again?/create`, { form: { ...body, title: 'Different title same key' }, headers: { origin }, maxRedirects: 0 });
  expect(conflict.status()).toBe(409);
  expect(await conflict.json()).toMatchObject({ type: 'failure', status: 409 });
  const invalidDate = await page.request.post(`/chores/week/again?/create`, { form: { ...body, dueDate: 'not-a-date' }, headers: { origin }, maxRedirects: 0 });
  expect(invalidDate.status()).toBe(400);
  expect(await invalidDate.json()).toMatchObject({ type: 'failure', status: 400 });
  await page.goto('/chores/week?date=2099-11-01');
  await expect(page.getByRole('article').filter({ hasText: title })).toHaveCount(1);
});

test('a source changed after review rejects the batch instead of overwriting newer work', async ({ page, browser }) => {
  const household = await reuseHousehold();
  await signInParent(page, household);
  await chooseSource(page, 'Stale source chore');
  const form = page.getByRole('form', { name: 'Assign Stale source chore again' });
  const sourceUpdatedAt = await form.locator('input[name="sourceUpdatedAt"]').inputValue();
  await form.getByRole('checkbox', { name: 'Reuse Kid Two' }).uncheck();
  await form.getByRole('checkbox', { name: 'Reuse Kid Three' }).uncheck();
  await form.getByLabel('Date', { exact: true }).fill('2099-12-01');
  await form.getByRole('button', { name: 'Review assignments' }).click();
  const preview = page.getByRole('region', { name: 'Assignment preview' });

  const second = await browser.newContext();
  try {
    await signInAs(second, household.members['Reuse Parent Two']);
    const assignee = await form.getByRole('checkbox', { name: 'Reuse Kid One' }).getAttribute('value');
    const changed = await second.request.post('/chores/week?/edit&week=2099-01-11', {
      form: { id: household.chores.stale, updatedAt: sourceUpdatedAt, title: 'Stale source changed', description: 'Changed after review', assignee: assignee!, dueDate: '2099-01-17', reward: '0.50' },
      headers: { origin }, maxRedirects: 0
    });
    expect(changed.status()).toBe(200);
  } finally { await second.close(); }

  await preview.getByRole('button', { name: 'Create 1 assignment' }).click();
  await expect(page.getByRole('alert')).toContainText('source chore changed');
  await page.goto('/chores/week?date=2099-12-01');
  await expect(page.getByText('Stale source chore')).toHaveCount(0);
});

test('reuse works without JavaScript', async ({ page, browser }) => {
  await signInParent(page, await reuseHousehold());
  const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    const native = await context.newPage();
    await native.goto('/chores/week/again?date=2099-12-06');
    const search = native.getByRole('form', { name: 'Find a recent chore', exact: true });
    await search.getByRole('textbox', { name: 'Search recent chores', exact: true }).fill('Native reuse chore');
    await search.getByRole('button', { name: 'Search', exact: true }).click();
    await settle(search);
    await expect(native).toHaveURL(url => url.searchParams.get('q') === 'Native reuse chore' && url.searchParams.get('date') === '2099-12-06');
    const result = native.getByRole('article').filter({ has: native.getByRole('heading', { name: 'Native reuse chore', exact: true }) });
    await result.getByRole('link', { name: 'Use this chore', exact: true }).click();
    await settle(result);
    const form = native.getByRole('form', { name: 'Assign Native reuse chore again' });
    await form.getByRole('checkbox', { name: 'Reuse Kid Two' }).uncheck();
    await form.getByRole('checkbox', { name: 'Reuse Kid Three' }).uncheck();
    await form.getByLabel('Date', { exact: true }).fill('2099-12-06');
    await form.getByRole('button', { name: 'Review assignments' }).click();
    const preview = native.getByRole('region', { name: 'Assignment preview' });
    await expect(preview).toContainText('1 assignment ready');
    await preview.getByRole('button', { name: 'Create 1 assignment' }).click();
    await expect(native.getByRole('status').filter({ hasText: '1 chore was assigned' })).toBeVisible();
    await expect(native.getByRole('region', { name: 'Chores for 2099-12-06', exact: true }).getByRole('article', { name: 'Native reuse chore for Reuse Kid One' })).toBeVisible();
  } finally { await context.close(); }
});

test('a search edit and selection survive delayed hydration', async ({ page }) => {
  await signInParent(page, await reuseHousehold());
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const blocked = new Promise<void>(resolve => { requested = resolve; });
  const moduleUrl = pageModule('chores/week/again');
  const delay = async (route: Route) => { requested(); await gate; await route.continue(); };
  await page.route(moduleUrl, delay);
  try {
    await page.goto('/chores/week/again?date=2099-12-13&q=Clean+bedroom', { waitUntil: 'commit' });
    await blocked;
    const main = page.getByRole('main');
    const search = main.getByRole('form', { name: 'Find a recent chore', exact: true });
    const query = search.getByRole('textbox', { name: 'Search recent chores', exact: true });
    await expect(main).toHaveAttribute('data-hydrated', 'false');
    await query.fill('Water the plants');
    await query.selectText();
    release();
    await expect(main).toHaveAttribute('data-hydrated', 'true');
    await expect(query).toBeFocused();
    await page.keyboard.insertText('Water plants');
    await expect(query).toHaveValue('Water plants');
    await search.getByRole('button', { name: 'Search', exact: true }).click();
    await settle(search);
    await expect(page).toHaveURL(url => url.searchParams.get('q') === 'Water plants' && url.searchParams.get('date') === '2099-12-13');
    await expect(main.getByRole('heading', { name: 'Water plants', exact: true })).toBeVisible();
  } finally {
    release();
    await page.unroute(moduleUrl, delay);
  }
});

test('reuse edits and child selections survive delayed hydration', async ({ page, browser }) => {
  const household = await reuseHousehold();
  await signInParent(page, household);
  const context = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const blocked = new Promise<void>(resolve => { requested = resolve; });
  try {
    const delayed = await context.newPage();
    await delayed.route(pageModule('chores/week/again'), async route => { requested(); await gate; await route.continue(); });
    await delayed.goto(`/chores/week/again?date=2099-12-13&source=${encodeURIComponent(household.chores.hydration)}`, { waitUntil: 'commit' });
    await blocked;
    const form = delayed.getByRole('form', { name: 'Assign Hydration reuse chore again' });
    await form.getByRole('textbox', { name: 'Description (optional)', exact: true }).fill('Hydrated reuse description');
    await form.getByLabel('Date', { exact: true }).fill('2099-12-14');
    await form.getByRole('checkbox', { name: 'Reuse Kid Two' }).uncheck();
    await form.getByRole('checkbox', { name: 'Reuse Kid Three' }).uncheck();
    const title = form.getByLabel('Chore title', { exact: true });
    await title.fill('Before reuse hydration');
    await title.focus();
    await title.evaluate((input: HTMLInputElement) => input.select());
    release();
    await hydrated(delayed);
    await delayed.keyboard.insertText('After reuse hydration');
    await expect(form.getByRole('textbox', { name: 'Description (optional)', exact: true })).toHaveValue('Hydrated reuse description');
    await expect(form.getByLabel('Date', { exact: true })).toHaveValue('2099-12-14');
    await expect(form.getByRole('checkbox', { name: 'Reuse Kid One' })).toBeChecked();
    await expect(form.getByRole('checkbox', { name: 'Reuse Kid Two' })).not.toBeChecked();
    await expect(form.getByRole('checkbox', { name: 'Reuse Kid Three' })).not.toBeChecked();
    expect(await form.evaluate(element => Object.fromEntries(new FormData(element as HTMLFormElement)))).toMatchObject({
      title: 'After reuse hydration', description: 'Hydrated reuse description', dueDate: '2099-12-14', assignee: await form.getByRole('checkbox', { name: 'Reuse Kid One' }).getAttribute('value')
    });
  } finally { release(); await context.close(); }
});

test('reuse rejects child, cross-household, disabled and cross-origin requests', async ({ page, browser }) => {
  const anonymous = await page.request.get('/chores/week/again', { maxRedirects: 0 });
  expect(anonymous.status()).toBe(303);
  const household = await reuseHousehold();
  await signInParent(page, household);
  expect((await page.request.get(`/chores/week/again?q=${'x'.repeat(81)}`, { maxRedirects: 0 })).status()).toBe(400);
  const forged = await page.request.post('/chores/week/again?/create', { form: { sourceId: household.chores.clean, sourceUpdatedAt: 'x', submissionKey: 'forged-reuse-key-0001', title: 'Forged', dueDate: '2099-10-10', assignee: 'x' }, headers: { origin: 'https://attacker.example.test' } });
  expect(forged.status()).toBe(403);

  const child = await browser.newContext();
  try {
    await signInAs(child, household.members['Reuse Kid One']);
    expect((await child.request.get('/chores/week/again', { maxRedirects: 0 })).status()).toBe(403);
    expect((await child.request.post('/chores/week/again?/create', { form: { sourceId: household.chores.clean, sourceUpdatedAt: 'x', submissionKey: 'child-reuse-key-0001', title: 'Child forged', dueDate: '2099-10-10', assignee: 'x' }, headers: { origin } })).status()).toBe(403);
  } finally { await child.close(); }

  const other = await browser.newContext();
  try {
    const elsewhere = await freshHousehold({ name: 'Other household', members: [{ name: 'Other Parent', role: 'parent' }] });
    await signInAs(other, elsewhere.members['Other Parent']);
    expect((await other.request.get(`/chores/week/again?source=${encodeURIComponent(household.chores.clean)}`, { maxRedirects: 0 })).status()).toBe(400);
  } finally { await other.close(); }

  const disabled = await browser.newContext();
  try {
    await signInAs(disabled, household.members['Disabled Reuse Parent']);
    expect((await disabled.request.get('/chores/week/again', { maxRedirects: 0 })).status()).toBe(303);
  } finally { await disabled.close(); }
});
