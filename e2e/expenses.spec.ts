import { expect, test, type Browser, type Page } from '@playwright/test';

async function signIn(page: Page, account = 'parent') {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(account + '@example.test');
  await page.getByLabel('Password').fill('synthetic-' + account + '-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

function dateAfter(days: number) {
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const date = new Date(local + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function parentPage(browser: Browser, width: number, javaScriptEnabled = true) {
  const authenticated = await browser.newContext();
  await signIn(await authenticated.newPage());
  const storageState = await authenticated.storageState();
  await authenticated.close();
  const context = await browser.newContext({ viewport: { width, height: 850 }, javaScriptEnabled, storageState });
  const page = await context.newPage();
  return { context, page };
}

test('parent plans a one-off expense, records payment and reverses it with native forms on a phone', async ({ browser }, testInfo) => {
  const { context, page } = await parentPage(browser, 375, false);
  try {
    await page.goto('/expenses?days=90');
    await expect(page.getByRole('heading', { name: 'Expenses', exact: true })).toBeVisible();
    await page.getByText('Add expense', { exact: true }).click();
    const add = page.getByRole('form', { name: 'Add expense' });
    await add.getByLabel('Title').fill('Synthetic phone internet');
    await add.getByLabel('Planned amount').fill('70.001');
    await add.getByLabel('Due date').fill(dateAfter(35));
    await add.getByLabel('Notes').fill('Synthetic bill note');
    await add.getByRole('button', { name: 'Save expense' }).click();
    await expect(page.getByRole('alert')).toContainText('amount');
    await expect(add.getByLabel('Title')).toHaveValue('Synthetic phone internet');
    await expect(add.getByLabel('Notes')).toHaveValue('Synthetic bill note');
    await expect(add.getByLabel('Due date')).toHaveValue(dateAfter(35));
    await expect(page).toHaveURL(/days=90/);
    await add.getByLabel('Planned amount').fill('70');
    await add.getByRole('button', { name: 'Save expense' }).click();
    const bill = page.getByRole('region', { name: 'Upcoming expenses' }).getByRole('article').filter({ hasText: 'Synthetic phone internet' });
    await expect(bill).toContainText('$70.00');
    await expect(page).toHaveURL(/days=90/);
    await bill.getByText('Record paid', { exact: true }).click();
    const pay = bill.getByRole('form', { name: 'Record payment' });
    await pay.getByLabel('Actual payment date').fill(dateAfter(1));
    await pay.getByLabel('Actual paid amount').fill('69.50');
    await pay.getByLabel('Payment note').fill('Synthetic receipt');
    await pay.getByRole('button', { name: 'Save payment' }).click();
    await expect(page.getByRole('alert')).toContainText('future');
    await expect(pay.getByLabel('Actual paid amount')).toHaveValue('69.50');
    await expect(pay.getByLabel('Payment note')).toHaveValue('Synthetic receipt');
    await pay.getByLabel('Actual payment date').fill(dateAfter(0));
    await pay.getByRole('button', { name: 'Save payment' }).click();
    await expect(bill).toContainText('Recorded paid');
    const history = page.getByRole('region', { name: 'Payment history' });
    const receipt = history.getByRole('article').filter({ hasText: 'Synthetic phone internet' });
    await expect(receipt).toContainText('$69.50');
    await page.screenshot({ path: testInfo.outputPath('expenses-mobile.png'), fullPage: true });
    await receipt.getByText('Reverse payment', { exact: true }).click();
    await receipt.getByLabel('Reason').fill('Wrong receipt');
    await receipt.getByRole('button', { name: 'Confirm reversal' }).click();
    await expect(receipt).toContainText('Wrong receipt');
    await expect(receipt).toContainText('Reversed');
    await expect(bill).toContainText('Upcoming');
  } finally { await context.close(); }
});

test('monthly expenses survive delayed hydration and support skip, pause, resume and end', async ({ browser }, testInfo) => {
  const { context, page } = await parentPage(browser, 1280);
  let release!: () => void;
  let blocked!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { blocked = resolve; });
  const title = 'Synthetic desktop insurance';
  try {
    await page.route('**/src/routes/expenses/+page.svelte*', async route => { blocked(); await gate; await route.continue(); });
    await page.goto('/expenses?days=90', { waitUntil: 'commit' });
    await requested;
    await page.getByText('Add expense', { exact: true }).click();
    const add = page.getByRole('form', { name: 'Add expense' });
    await add.getByLabel('Title').fill(title);
    await add.getByLabel('Planned amount').fill('420');
    await add.getByLabel('Frequency').selectOption('monthly');
    await add.getByLabel('Due date').fill(dateAfter(4));
    await add.getByLabel('Notes').fill('Synthetic policy note');
    await add.getByLabel('Payee').fill('Synthetic provider');
    release();
    await page.waitForLoadState('networkidle');
    await expect(add.getByLabel('Title')).toHaveValue(title);
    await expect(add.getByLabel('Frequency')).toHaveValue('monthly');
    await add.getByRole('button', { name: 'Save expense' }).click();
    const upcoming = page.getByRole('region', { name: 'Upcoming expenses' });
    const occurrences = upcoming.getByRole('article').filter({ hasText: title });
    const first = occurrences.filter({ has: page.locator('time[datetime="' + dateAfter(4) + '"]') });
    await expect(first).toContainText('$420.00');
    await expect(first).toContainText('Synthetic provider');
    await expect(first).toContainText('Synthetic policy note');
    await expect(occurrences).toHaveCount(3);
    const plan = page.getByRole('region', { name: 'Expense plans' }).getByRole('article').filter({ hasText: title });
    await plan.getByText('Edit expense', { exact: true }).click();
    const edit = plan.getByRole('form', { name: 'Edit ' + title });
    await edit.getByLabel('Planned amount').fill('422');
    await edit.getByRole('button', { name: 'Save expense' }).click();
    await expect(first).toContainText('$422.00');
    await first.getByText('Record paid', { exact: true }).click();
    const pay = first.getByRole('form', { name: 'Record payment' });
    await pay.getByRole('button', { name: 'Save payment' }).click();
    await expect(first).toContainText('Recorded paid');
    const next = occurrences.filter({ hasNotText: 'Recorded paid' });
    const nextDate = await next.locator('time').evaluateAll(elements => elements.map(element => element.getAttribute('datetime')).sort()[0]);
    const skipped = next.filter({ has: page.locator('time[datetime="' + nextDate + '"]') });
    await skipped.getByRole('button', { name: 'Skip this occurrence' }).click();
    await expect(occurrences).toHaveCount(2);
    await plan.getByRole('button', { name: 'Pause recurrence' }).click();
    await expect(plan).toContainText('Paused');
    await expect(occurrences).toHaveCount(0);
    const receipt = page.getByRole('region', { name: 'Payment history' }).getByRole('article').filter({ hasText: title });
    await expect(receipt).toContainText('Recorded paid');
    await plan.getByRole('button', { name: 'Resume recurrence' }).click();
    await expect(plan).toContainText('Active');
    await expect(occurrences).toHaveCount(2);
    await expect(skipped).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('expenses-desktop.png'), fullPage: true });
    await plan.getByText('End recurrence', { exact: true }).click();
    await plan.getByRole('button', { name: 'Confirm end' }).click();
    await expect(plan).toContainText('Ended');
    await expect(occurrences).toHaveCount(0);
    await expect(receipt).toContainText('Recorded paid');
  } finally { release(); await context.close(); }
});

test('expense loads and actions stay within active parent households', async ({ playwright }) => {
  const origin = 'http://127.0.0.1:4173';
  const headers = { origin, accept: 'application/json', 'x-sveltekit-action': 'true' };
  const clients = [];
  try {
    for (const account of ['anonymous', 'parent', 'kid', 'other-parent', 'disabled-expense']) {
      const client = await playwright.request.newContext({ baseURL: origin });
      clients.push(client);
      if (account === 'anonymous') continue;
      const login = await client.post('/api/auth/sign-in/email', { headers: { origin }, data: { email: account + '@example.test', password: 'synthetic-' + account + '-password' } });
      expect(login.status()).toBe(200);
      if (account !== 'disabled-expense') expect((await client.get('/dashboard', { maxRedirects: 0 })).status()).toBe(200);
    }
    const [anonymous, parent, child, other, disabled] = clients;
    const pairedDisplay = await playwright.request.newContext({ baseURL: origin });
    clients.push(pairedDisplay);
    const pairing = await parent.post('/settings/displays?/create', { headers, form: { label: 'Synthetic expense access display' } });
    expect(pairing.status()).toBe(200);
    const pairingResult = await pairing.json();
    expect(pairingResult.type).toBe('success');
    const code = pairingResult.data.match(/(?:[A-Z2-9]{4}-){5}[A-Z2-9]{4}/)?.[0];
    expect(code).toBeTruthy();
    const pair = await pairedDisplay.post('/display/pair', { headers, form: { code: code ?? '' }, maxRedirects: 0 });
    expect(await pair.json()).toMatchObject({ type: 'redirect', status: 303 });
    expect((await pairedDisplay.get('/display/data')).status()).toBe(200);
    const form = { title: 'Private synthetic expense', dueDate: dateAfter(2), cadence: 'once', amount: '20.55', notes: 'Private synthetic note' };
    const create = await parent.post('/expenses?/save', { headers, form });
    expect(await create.json()).toMatchObject({ type: 'redirect', status: 303 });
    const view = await parent.get('/expenses');
    expect(view.headers()['cache-control']).toBe('no-store');
    const html = await view.text();
    expect(html).toContain(form.title);
    const bill = html.split('<article').find(article => article.includes(form.title));
    const id = /name="id" value="([0-9a-f-]{36})"/.exec(bill ?? '')?.[1];
    expect(id).toBeTruthy();

    const unauthenticated = await anonymous.post('/expenses?/save', { headers, form });
    expect(await unauthenticated.json()).toMatchObject({ type: 'redirect', status: 303, location: '/sign-in' });
    expect((await anonymous.get('/expenses', { maxRedirects: 0 })).status()).toBe(303);
    expect((await pairedDisplay.get('/expenses', { maxRedirects: 0 })).status()).toBe(303);
    expect(await (await pairedDisplay.post('/expenses?/save', { headers, form })).json()).toMatchObject({ type: 'redirect', status: 303, location: '/sign-in' });
    expect(await (await pairedDisplay.get('/display/data')).text()).not.toContain(form.notes);
    for (const client of [child, disabled]) {
      const denied = await client.get('/expenses', { maxRedirects: 0 });
      expect(denied.status()).toBe(403);
      expect(denied.headers()['cache-control']).toBe('no-store');
      expect(await denied.text()).not.toContain(form.title);
      const action = await client.post('/expenses?/save', { headers, form });
      expect(action.status()).toBe(403);
      expect(await action.json()).toMatchObject({ type: 'error' });
    }
    const otherView = await other.get('/expenses?household=foreign');
    expect(otherView.status()).toBe(200);
    expect(await otherView.text()).not.toContain(form.notes);
    const update = await other.post('/expenses?/save', { headers, form: { ...form, id: id ?? '', title: 'Wrong household' } });
    expect(await update.json()).toMatchObject({ type: 'failure', status: 400 });
    const after = await parent.get('/expenses');
    expect(await after.text()).toContain(form.title);
    const crossOrigin = await parent.post('/expenses?/save', { headers: { ...headers, origin: 'https://elsewhere.example.test' }, form });
    expect(crossOrigin.status()).toBe(403);
  } finally { await Promise.all(clients.map(client => client.dispose())); }
});
