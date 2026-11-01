import { expect, test } from '@playwright/test';

test('parent dashboard shows today’s meals and child dashboard does not expose them', async ({ page, browser }, testInfo) => {
  const linked = `Family supper linked ${testInfo.repeatEachIndex}`;
  const unlinked = `Family supper unlinked ${testInfo.repeatEachIndex}`;
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  const display = await page.request.get('/display/data');
  expect(display.status()).toBe(200);
  const today = (await display.json()).today as string;
  await page.goto(`/meals?date=${today}`);
  for (const meal of [{ title: linked, ingredients: '2 cups synthetic beans', link: 'https://example.test/family-recipe' }, { title: unlinked, ingredients: '1 synthetic carrot', link: '' }]) {
    await page.getByText('Add a meal', { exact: true }).click();
    const form = page.getByRole('form', { name: 'Add meal' });
    await form.getByLabel('Meal name').fill(meal.title);
    await form.getByLabel('Ingredients').fill(meal.ingredients);
    await form.getByLabel('Private notes (optional)').fill(`Private card note ${meal.title}`);
    if (meal.link) await form.getByLabel('Recipe link (optional)').fill(meal.link);
    await form.getByRole('button', { name: 'Save meal' }).click();
    await expect(page.getByRole('article').filter({ hasText: meal.title })).toBeVisible();
  }
  const future = `Future family supper ${testInfo.repeatEachIndex}`;
  await page.goto('/meals?date=2099-06-03');
  await page.getByText('Add a meal', { exact: true }).click();
  const futureForm = page.getByRole('form', { name: 'Add meal' });
  await futureForm.getByLabel('Meal name').fill(future);
  await futureForm.getByRole('button', { name: 'Save meal' }).click();
  await expect(page.getByRole('article').filter({ hasText: future })).toBeVisible();
  const response = await page.goto('/dashboard');
  expect(response?.headers()['cache-control']).toContain('no-store');
  const dinner = page.getByRole('region', { name: "Tonight's meal" });
  const linkedMeal = dinner.getByRole('article').filter({ hasText: linked });
  const plainMeal = dinner.getByRole('article').filter({ hasText: unlinked });
  await expect(linkedMeal).toContainText('2 cups synthetic beans');
  await expect(linkedMeal.getByRole('link', { name: 'View recipe' })).toHaveAttribute('href', 'https://example.test/family-recipe');
  await expect(plainMeal).toContainText('1 synthetic carrot');
  await expect(plainMeal.getByRole('link', { name: /recipe|eMeals/i })).toHaveCount(0);
  expect(await page.content()).not.toContain('Private card note');
  expect(await page.content()).not.toContain(future);
  await page.screenshot({ path: testInfo.outputPath('parent-meal-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: testInfo.outputPath('parent-meal-desktop.png'), fullPage: true });

  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  try {
    const kid = await context.newPage();
    await kid.goto('/sign-in');
    await kid.getByLabel('Email').fill('kid@example.test');
    await kid.getByLabel('Password').fill('synthetic-kid-password');
    await kid.getByRole('button', { name: 'Sign in' }).click();
    await expect(kid.getByRole('heading', { name: "Sample Kid's My Day" })).toBeVisible();
    await expect(kid.getByRole('region', { name: "Tonight's meal" })).toHaveCount(0);
    expect(await kid.content()).not.toContain(linked);
    expect(await kid.content()).not.toContain(unlinked);
  } finally { await context.close(); }
  const otherContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  try {
    const other = await otherContext.newPage();
    await other.goto('/sign-in');
    await other.getByLabel('Email').fill('other-parent@example.test');
    await other.getByLabel('Password').fill('synthetic-other-parent-password');
    await other.getByRole('button', { name: 'Sign in' }).click();
    await expect(other.getByRole('heading', { name: 'Hello, Other Parent' })).toBeVisible();
    await expect(other.getByRole('region', { name: "Tonight's meal" })).toContainText('No meals planned for today.');
    expect(await other.content()).not.toContain(linked);
    expect(await other.content()).not.toContain(unlinked);
  } finally { await otherContext.close(); }
});

test('a parent plans a meal and explicitly shares its ingredients on the display', async ({ page }, testInfo) => {
  const title = `Synthetic dinner ${testInfo.repeatEachIndex}`;
  await page.setViewportSize({ width: 375, height: 812 });
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
  const savedMeal = page.getByRole('article').filter({ hasText: title });
  await expect(savedMeal).toBeVisible();
  await expect(savedMeal.getByRole('link', { name: 'Open in eMeals' })).toHaveAttribute('href', 'https://example.test/synthetic-recipe');
  await page.screenshot({ path: testInfo.outputPath('meal-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/display');
  const dinner = page.getByRole('region', { name: "Tonight's dinner" });
  await expect(dinner).toContainText(title);
  await expect(dinner).toContainText('2 cups beans');
  await expect(dinner).toContainText('Source: eMeals');
  await expect(dinner.getByRole('article').filter({ hasText: title }).getByRole('link', { name: 'Open in eMeals' })).toHaveAttribute('href', 'https://example.test/synthetic-recipe');
  await expect(page.locator('body')).not.toContainText('Synthetic private note');
  await page.screenshot({ path: testInfo.outputPath('display-desktop.png'), fullPage: true });
  await page.route('https://example.test/synthetic-recipe', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<h1>Synthetic recipe destination</h1>'
  }));
  await dinner.getByRole('article').filter({ hasText: title }).getByRole('link', { name: 'Open in eMeals' }).click();
  await expect(page).toHaveURL('https://example.test/synthetic-recipe');
  await expect(page.getByRole('heading', { name: 'Synthetic recipe destination' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('region', { name: "Tonight's dinner" }).getByRole('article').filter({ hasText: title })).toContainText('2 cups beans');
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
  await expect(item.getByRole('link', { name: /recipe|eMeals/i })).toHaveCount(0);
  await item.getByText('Edit meal', { exact: true }).click();
  const edit = item.getByRole('form', { name: 'Edit Synthetic moving dinner' });
  await edit.getByLabel('Date', { exact: true }).fill('2099-02-02');
  await edit.getByLabel('Recipe source (optional)').fill('Family cookbook');
  await edit.getByLabel('Recipe link (optional)').fill('https://example.test/cookbook');
  await edit.getByRole('button', { name: 'Save meal' }).click();
  await expect(page.getByRole('heading', { name: 'Meals for 2099-02-02' })).toBeVisible();
  await expect(item).toBeVisible();
  await expect(item.getByRole('link', { name: 'View recipe' })).toHaveAttribute('href', 'https://example.test/cookbook');
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
    const name = form.getByLabel('Meal name');
    await name.focus();
    await name.evaluate((input: HTMLInputElement) => input.select());
    release(); await delayed.waitForLoadState('networkidle');
    await delayed.keyboard.insertText('Synthetic early dinner');
    await expect(form).toBeVisible();
    expect(await form.evaluate(element => Object.fromEntries(new FormData(element as HTMLFormElement)))).toMatchObject({ title: 'Synthetic early dinner', date: '2099-03-01', time: '18:30', servings: '4', ingredients: '2 apples', shared: 'on' });
  } finally { release(); await context.close(); }
});
