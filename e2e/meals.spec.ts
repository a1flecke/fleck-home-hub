import { expect, test } from '@playwright/test';

test('a parent plans a meal and explicitly shares its ingredients on the display', async ({ page }, testInfo) => {
  const title = `Synthetic dinner ${testInfo.repeatEachIndex}`;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  expect((await page.request.get('/meals', { maxRedirects: 0 })).status()).toBe(303);
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await page.goto(`/meals?date=${today}`);
  await page.getByText('Add a meal', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Add meal' });
  await form.getByLabel('Meal name').fill(title);
  await form.getByLabel('Ingredients').fill('2 cups beans\n1 onion');
  await form.getByLabel('Private notes (optional)').fill('Synthetic private note');
  await form.getByLabel('Recipe source (optional)').fill('eMeals');
  await form.getByLabel('Recipe link (optional)').fill('https://example.test/synthetic-recipe');
  await form.getByLabel('Share on family display').check();
  await form.getByRole('button', { name: 'Save meal' }).click();
  await expect(page.getByRole('article').filter({ hasText: title })).toBeVisible();
  await page.goto('/display');
  const dinner = page.getByRole('region', { name: "Tonight's dinner" });
  await expect(dinner).toContainText(title);
  await expect(dinner).toContainText('2 cups beans');
  await expect(dinner).toContainText('Source: eMeals');
  await expect(dinner.getByRole('link', { name: 'View recipe' })).toHaveAttribute('href', 'https://example.test/synthetic-recipe');
  await expect(page.locator('body')).not.toContainText('Synthetic private note');
});

for (const javaScriptEnabled of [true, false]) test(`invalid meals retain entered details for correction (JavaScript ${javaScriptEnabled ? 'on' : 'off'})`, async ({ page, browser }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  const context = await browser.newContext({ javaScriptEnabled, storageState: await page.context().storageState() });
  try {
    const mealPage = await context.newPage();
    await mealPage.goto('/meals?date=2099-01-01');
    await mealPage.getByText('Add a meal', { exact: true }).click();
    const form = mealPage.getByRole('form', { name: 'Add meal' });
    await form.getByLabel('Meal name').fill('   ');
    await form.getByLabel('Ingredients').fill('3 carrots');
    await form.getByLabel('Share on family display').check();
    await form.getByRole('button', { name: 'Save meal' }).click();
    await expect(mealPage.getByRole('status')).toContainText('Unable to save meal');
    await expect(form.getByLabel('Ingredients')).toHaveValue('3 carrots');
    await expect(form.getByLabel('Share on family display')).toBeChecked();
    await form.getByLabel('Meal name').fill(`Corrected dinner ${javaScriptEnabled}`);
    await form.getByRole('button', { name: 'Save meal' }).click();
    await expect(mealPage.getByRole('article').filter({ hasText: `Corrected dinner ${javaScriptEnabled}` })).toBeVisible();
  } finally { await context.close(); }
});

test('child and cross-origin meal mutations are rejected at the server', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('kid@example.test');
  await page.getByLabel('Password').fill('synthetic-kid-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: "Sample Kid's My Day" })).toBeVisible();
  const response = await page.request.post('/meals?/save', { form: { title: 'Forbidden meal', date: '2099-01-01', ingredients: 'Synthetic', shared: 'on' }, headers: { origin: 'http://127.0.0.1:4173' } });
  expect(await response.json()).toMatchObject({ type: 'failure', status: 403 });
  const crossOrigin = await page.request.post('/meals?/save', { form: { title: 'Forbidden meal', date: '2099-01-01' }, headers: { origin: 'https://other.example.test' } });
  expect(crossOrigin.status()).toBe(403);
  const view = await page.goto('/meals?date=2099-01-01');
  expect(view?.headers()['cache-control']).toContain('no-store');
  await expect(page.getByText('Forbidden meal')).toHaveCount(0);
});

test('editing a meal to another date shows the saved meal at its new date', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await page.goto('/meals?date=2099-02-01');
  await page.getByText('Add a meal', { exact: true }).click();
  const add = page.getByRole('form', { name: 'Add meal' });
  await add.getByLabel('Meal name').fill('Synthetic moving dinner');
  await add.getByRole('button', { name: 'Save meal' }).click();
  const item = page.getByRole('article').filter({ hasText: 'Synthetic moving dinner' });
  await expect(item).toBeVisible();
  await item.getByText('Edit meal', { exact: true }).click();
  const edit = item.getByRole('form', { name: 'Edit Synthetic moving dinner' });
  await edit.getByLabel('Date', { exact: true }).fill('2099-02-02');
  await edit.getByRole('button', { name: 'Save meal' }).click();
  await expect(page.getByRole('heading', { name: 'Meals for 2099-02-02' })).toBeVisible();
  await expect(item).toBeVisible();
});

test('meal form edits and disclosure survive delayed hydration', async ({ page, browser }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  let release!: () => void, requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const blocked = new Promise<void>(resolve => { requested = resolve; });
  try {
    const delayed = await context.newPage();
    await delayed.route('**/src/routes/meals/+page.svelte*', async route => { requested(); await gate; await route.continue(); });
    await delayed.goto('/meals?date=2099-03-01', { waitUntil: 'commit' });
    await blocked;
    await delayed.getByText('Add a meal', { exact: true }).click();
    const form = delayed.getByRole('form', { name: 'Add meal' });
    await form.getByLabel('Meal name').fill('Synthetic early dinner');
    await form.getByLabel('Serving time (optional)').fill('18:30');
    await form.getByLabel('Servings (optional)').fill('4');
    await form.getByLabel('Ingredients').fill('2 apples');
    await form.getByLabel('Share on family display').check();
    release(); await delayed.waitForLoadState('networkidle');
    await expect(form).toBeVisible();
    expect(await form.evaluate(element => Object.fromEntries(new FormData(element as HTMLFormElement)))).toMatchObject({ title: 'Synthetic early dinner', date: '2099-03-01', time: '18:30', servings: '4', ingredients: '2 apples', shared: 'on' });
  } finally { release(); await context.close(); }
});
