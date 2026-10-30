import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, role: 'parent' | 'kid') {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(`${role}@example.test`);
  await page.getByLabel('Password').fill(`synthetic-${role}-password`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /hello|my day/i })).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome home' })).toBeVisible();
}

async function create(page: Page, title: string) {
  await page.getByText('Add a chore', { exact: true }).click();
  const form = page.locator('form[action="?/create"]');
  await form.getByLabel('Chore title', { exact: true }).fill(title);
  await form.getByRole('combobox', { name: 'Assigned child', exact: true }).selectOption({ label: 'Sample Kid' });
  await form.getByLabel('Due date', { exact: true }).fill('2026-11-01');
  await form.getByLabel('Reward in dollars', { exact: true }).fill('2.00');
  await form.getByRole('button', { name: 'Add chore', exact: true }).click();
  await expect(page.getByRole('article').filter({ hasText: title })).toBeVisible();
}

test('child submits and parent verifies a paid chore', async ({ page }, testInfo) => {
  const title = `Feed the cat ${testInfo.repeatEachIndex}`;
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, 'parent');
  await create(page, title);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('parent-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await signOut(page);
  await signIn(page, 'kid');
  const kidChore = page.getByRole('article').filter({ hasText: title });
  const pending = page.getByText(/^Waiting for verification:/);
  const earned = page.getByText(/^Verified earnings owed:/);
  const earnedBefore = await earned.innerText();
  const pendingBefore = (await pending.innerText()).match(/\$(\d+)\.(\d{2})$/)!;
  const pendingCents = Number(pendingBefore[1]) * 100 + Number(pendingBefore[2]);
  const choreId = await kidChore.locator('input[name="id"]').inputValue();
  await kidChore.getByRole('button', { name: 'Mark complete' }).click();
  await expect(page.getByText('Nice job! Waiting for a parent to check.')).toBeVisible();
  await expect(pending).toHaveText(`Waiting for verification: $${((pendingCents + 200) / 100).toFixed(2)}`);
  await expect(earned).toHaveText(earnedBefore);
  const unauthorized = await page.request.post('/dashboard?/transition', { form: { id: choreId, action: 'verify' }, headers: { origin: 'http://127.0.0.1:4173' } });
  expect(unauthorized.status()).not.toBe(200);
  await page.screenshot({ path: testInfo.outputPath('kid-mobile.png'), fullPage: true });
  await signOut(page);
  await signIn(page, 'parent');
  await kidChore.getByRole('button', { name: 'Verify' }).click();
  await expect(kidChore.getByText('Approved! You earned $2.00!')).toBeVisible();
  await signOut(page);
  await signIn(page, 'kid');
  await expect(kidChore.getByText('Approved! You earned $2.00!')).toBeVisible();
});

test('parent returns work and child resubmits before verification', async ({ page }, testInfo) => {
  const title = `Tidy the table ${testInfo.repeatEachIndex}`;
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, 'parent');
  await create(page, title);
  await signOut(page);
  await signIn(page, 'kid');
  await page.getByRole('article').filter({ hasText: title }).getByRole('button', { name: 'Mark complete' }).click();
  await expect(page.getByRole('article').filter({ hasText: title }).getByText('Waiting for parent verification')).toBeVisible();
  await signOut(page);
  await signIn(page, 'parent');
  const chore = page.getByRole('article').filter({ hasText: title });
  await chore.getByLabel('Rework reason').fill('Please wipe the corners');
  await chore.getByRole('button', { name: 'Needs rework' }).click();
  await expect(chore.getByText('Please wipe the corners')).toBeVisible();
  await signOut(page);
  await signIn(page, 'kid');
  await expect(chore.getByText('Please wipe the corners')).toBeVisible();
  await chore.getByRole('button', { name: 'Mark complete' }).click();
  await expect(chore.getByText('Waiting for parent verification')).toBeVisible();
  await signOut(page);
  await signIn(page, 'parent');
  await chore.getByRole('button', { name: 'Verify' }).click();
  await expect(chore.getByText('Approved! You earned $2.00!')).toBeVisible();
  await signOut(page);
  await signIn(page, 'kid');
  await expect(chore.getByText('Approved! You earned $2.00!')).toBeVisible();
});

test('sign out works immediately after submitting a chore without client JavaScript', async ({ page, browser }, testInfo) => {
  const title = `No script chore ${testInfo.repeatEachIndex}`;
  await signIn(page, 'parent');
  await create(page, title);
  await signOut(page);
  await signIn(page, 'kid');
  const state = await page.context().storageState();
  const context = await browser.newContext({ javaScriptEnabled: false, storageState: state, viewport: { width: 375, height: 812 } });
  try {
    const noScriptPage = await context.newPage();
    await noScriptPage.goto('/dashboard');
    await noScriptPage.getByRole('article').filter({ hasText: title }).getByRole('button', { name: 'Mark complete' }).click();
    await expect(noScriptPage.getByRole('article').filter({ hasText: title }).getByText('Waiting for parent verification')).toBeVisible();
    const forged = await noScriptPage.request.post('/sign-out', { form: {}, headers: { origin: 'https://attacker.example.test' } });
    expect(forged.status()).toBe(403);
    await noScriptPage.getByRole('button', { name: 'Sign out' }).click();
    await expect(noScriptPage.getByRole('heading', { name: 'Welcome home' })).toBeVisible();
    await noScriptPage.goto('/dashboard');
    await expect(noScriptPage.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    const staleContext = await browser.newContext({ javaScriptEnabled: false, storageState: state });
    try {
      const stalePage = await staleContext.newPage();
      await stalePage.goto('/dashboard');
      await expect(stalePage.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    } finally { await staleContext.close(); }
  } finally { await context.close(); }
});

test('server rejects anonymous, child and cross-origin mutations and hides other assignments', async ({ page }, testInfo) => {
  const title = `Private assignment ${testInfo.repeatEachIndex}`;
  const url = '/dashboard?/create';
  const body = { title: 'Forged chore', assignee: 'invalid', dueDate: '2026-11-01', reward: '2' };
  const anonymous = await page.request.post(url, { form: body, headers: { origin: 'http://127.0.0.1:4173' }, maxRedirects: 0 });
  expect(await anonymous.json()).toMatchObject({ type: 'redirect', status: 303, location: '/sign-in' });
  await signIn(page, 'parent');
  await expect(page.getByText('Forged chore')).toHaveCount(0);
  await page.getByText('Add a chore', { exact: true }).click();
  const form = page.locator('form[action="?/create"]');
  await form.getByLabel('Chore title', { exact: true }).fill(title);
  const kidId = await form.getByRole('combobox', { name: 'Assigned child', exact: true }).locator('option', { hasText: 'Sample Kid' }).getAttribute('value');
  await form.getByRole('combobox', { name: 'Assigned child', exact: true }).selectOption({ label: 'Other Kid' });
  await form.getByLabel('Due date', { exact: true }).fill('2026-11-01');
  await form.getByRole('button', { name: 'Add chore', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const forged = await page.request.post(url, { form: body, headers: { origin: 'https://attacker.example.test' } });
  expect(forged.status()).toBe(403);
  await signOut(page);
  await signIn(page, 'kid');
  await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
  const child = await page.request.post(url, { form: { ...body, assignee: kidId! }, headers: { origin: 'http://127.0.0.1:4173' } });
  expect(child.status()).not.toBe(200);
});

test('a recurring occurrence is submitted and verified independently', async ({ page }, testInfo) => {
  const title = `Daily feeding ${testInfo.repeatEachIndex}`;
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, 'parent');
  await page.getByText('Add a recurring chore', { exact: true }).click();
  const form = page.locator('form[action="?/series"]').first();
  await form.getByLabel('Recurring chore title').fill(title);
  await form.getByLabel('Recurring assigned child').selectOption({ label: 'Sample Kid' });
  const assignee = await form.getByLabel('Recurring assigned child').inputValue();
  for (const day of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) await form.getByLabel(day, { exact: true }).check();
  await form.getByLabel('Recurring reward in dollars').fill('2.00');
  await form.getByRole('button', { name: 'Add recurring chore' }).click();
  await expect(page.getByText('Recurring chore saved.')).toBeVisible();
  const series = page.getByRole('article').filter({ hasText: title }).filter({ hasText: 'Skip occurrence' });
  const seriesId = await series.locator('form[action="?/seriesControl"] input[name="id"]').first().inputValue();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const occurrence = page.getByRole('article').filter({ hasText: title }).filter({ hasText: `Due ${today}` });
  await expect(occurrence).toHaveCount(1);
  const scheduledDates = await page.getByRole('article').filter({ hasText: title }).filter({ hasText: 'To do' }).locator('p').filter({ hasText: 'Due ' }).allTextContents();
  expect(scheduledDates.map(text => text.match(/\d{4}-\d{2}-\d{2}/)?.[0])).toEqual([...scheduledDates.map(text => text.match(/\d{4}-\d{2}-\d{2}/)?.[0])].sort());
  await page.screenshot({ path: testInfo.outputPath('recurring-parent-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('recurring-parent-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await signOut(page);
  await signIn(page, 'kid');
  const childChange = await page.request.post('/dashboard?/seriesControl', { form: { id: seriesId, action: 'ended' }, headers: { origin: 'http://127.0.0.1:4173' } });
  expect(childChange.status()).toBe(400);
  expect(await childChange.json()).toMatchObject({ type: 'failure', status: 400 });
  const childCreate = await page.request.post('/dashboard?/series', { form: { title: 'Forged recurring', assignee, startDate: today, weekday: '1' }, headers: { origin: 'http://127.0.0.1:4173' } });
  expect(childCreate.status()).toBe(400);
  expect(await childCreate.json()).toMatchObject({ type: 'failure', status: 400 });
  const forgedOrigin = await page.request.post('/dashboard?/seriesControl', { form: { id: seriesId, action: 'ended' }, headers: { origin: 'https://attacker.example.test' } });
  expect(forgedOrigin.status()).toBe(403);
  await occurrence.getByRole('button', { name: 'Mark complete' }).click();
  await expect(occurrence.getByText('Waiting for parent verification')).toBeVisible();
  await signOut(page);
  await signIn(page, 'parent');
  await occurrence.getByRole('button', { name: 'Verify' }).click();
  await expect(occurrence.getByText('Approved! You earned $2.00!')).toBeVisible();
  await signOut(page);
  await signIn(page, 'kid');
  await expect(occurrence.getByText('Approved! You earned $2.00!')).toBeVisible();
});

test('recurring chores can be created before JavaScript runs', async ({ page, browser }, testInfo) => {
  const title = `No script recurring ${testInfo.repeatEachIndex}`;
  await signIn(page, 'parent');
  const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    const noScript = await context.newPage();
    await noScript.goto('/dashboard');
    await noScript.getByText('Add a recurring chore', { exact: true }).click();
    const form = noScript.locator('form[action="?/series"]').first();
    await form.getByLabel('Recurring chore title').fill(title);
    await form.getByLabel('Recurring assigned child').selectOption({ label: 'Sample Kid' });
    for (const day of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) await form.getByLabel(day, { exact: true }).check();
    await form.getByRole('button', { name: 'Add recurring chore' }).click();
    await expect(noScript.getByText('Recurring chore saved.')).toBeVisible();
    await expect(noScript.getByRole('article').filter({ hasText: title }).filter({ hasText: 'Skip occurrence' })).toBeVisible();
  } finally { await context.close(); }
});
