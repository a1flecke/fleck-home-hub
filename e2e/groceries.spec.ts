import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, email = 'parent@example.test', password = 'synthetic-parent-password') {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Hello, |My Day/ })).toBeVisible();
}

test('a household member adds and completes an item', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await page.goto('/groceries');
  const add = page.getByRole('form', { name: 'Add grocery item' });
  await add.getByLabel('Item', { exact: true }).fill('Synthetic apples');
  await add.getByLabel('Quantity', { exact: true }).fill('2');
  await add.getByLabel('Unit', { exact: true }).fill('bags');
  await add.getByRole('button', { name: 'Add item' }).click();
  const item = page.getByRole('article').filter({ hasText: 'Synthetic apples' });
  await expect(item).toContainText('2 bags');
  await item.getByRole('button', { name: 'Mark bought' }).click();
  await expect(item).toContainText('Bought');
});

test('a parent selects meal ingredients and confirms an existing item', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await page.goto('/meals?date=2099-06-01');
  await page.getByText('Add a meal', { exact: true }).click();
  const add = page.getByRole('form', { name: 'Add meal' });
  await add.getByLabel('Meal name').fill('Synthetic grocery dinner');
  await add.getByLabel('Ingredients').fill('2 cups synthetic lentils\n1 carrot');
  await add.getByRole('button', { name: 'Save meal' }).click();
  const meal = page.getByRole('article').filter({ hasText: 'Synthetic grocery dinner' });
  await expect(meal).toBeVisible();
  await meal.getByText('Add ingredients to groceries', { exact: true }).click();
  let ingredients = meal.getByRole('form', { name: 'Add ingredients for Synthetic grocery dinner' });
  await ingredients.getByLabel('2 cups synthetic lentils').check();
  await ingredients.getByRole('button', { name: 'Review selected ingredients' }).click();
  let review = page.getByRole('region', { name: 'Review ingredients for groceries' });
  let line = review.getByRole('group', { name: '2 cups synthetic lentils' });
  await expect(line.getByLabel('Item name')).toHaveValue('synthetic lentils');
  await expect(line.getByLabel('Quantity')).toHaveValue('2');
  await expect(line.getByLabel('Unit')).toHaveValue('cups');
  await review.getByRole('button', { name: 'Add reviewed items' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Added 1 item and skipped 0\.$/ })).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'synthetic lentils' })).toContainText('2 cups');

  await page.goto('/meals?date=2099-06-01');
  await meal.getByText('Add ingredients to groceries', { exact: true }).click();
  ingredients = meal.getByRole('form', { name: 'Add ingredients for Synthetic grocery dinner' });
  await ingredients.getByLabel('2 cups synthetic lentils').check();
  await ingredients.getByRole('button', { name: 'Review selected ingredients' }).click();
  review = page.getByRole('region', { name: 'Review ingredients for groceries' });
  line = review.getByRole('group', { name: '2 cups synthetic lentils' });
  await expect(line).toContainText('Already on your list: synthetic lentils (2 cups)');
  await expect(line.getByRole('radio', { name: 'Skip this item' })).toBeChecked();
  await line.getByRole('radio', { name: 'Keep separate duplicate' }).check();
  await review.getByRole('button', { name: 'Add reviewed items' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Added 1 item and skipped 0\.$/ })).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'synthetic lentils' })).toHaveCount(2);
  for (const item of await page.getByRole('article').filter({ hasText: 'synthetic lentils' }).all()) await expect(item).toContainText('2 cups');
});

test('a parent reviews parsed quantities, edits one item, skips another and resolves a duplicate', async ({ page }, testInfo) => {
  const stamp = Date.now();
  const onion = `synthetic review onion ${stamp}`;
  const beans = `synthetic black beans ${stamp}`;
  const basil = `Fresh synthetic basil ${stamp}`;
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();

  await page.goto('/groceries');
  const addItem = page.getByRole('form', { name: 'Add grocery item' });
  await addItem.getByLabel('Item', { exact: true }).fill(onion);
  await addItem.getByLabel('Quantity', { exact: true }).fill('2');
  await addItem.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByRole('article').filter({ hasText: onion })).toContainText('2');

  await page.goto('/meals?date=2099-09-01');
  await page.getByText('Add a meal', { exact: true }).click();
  const addMeal = page.getByRole('form', { name: 'Add meal' });
  await addMeal.getByLabel('Meal name').fill(`Synthetic review dinner ${stamp}`);
  await addMeal.getByLabel('Ingredients').fill(`2 cups ${beans}\n1 ${onion}\n${basil}`);
  await addMeal.getByRole('button', { name: 'Save meal' }).click();
  const meal = page.getByRole('article').filter({ hasText: `Synthetic review dinner ${stamp}` });
  await meal.getByText('Add ingredients to groceries', { exact: true }).click();
  const ingredients = meal.getByRole('form', { name: `Add ingredients for Synthetic review dinner ${stamp}` });
  await ingredients.getByLabel(`2 cups ${beans}`).check();
  await ingredients.getByLabel(`1 ${onion}`).check();
  await ingredients.getByLabel(basil).check();
  await ingredients.getByRole('button', { name: 'Review selected ingredients' }).click();

  const review = page.getByRole('region', { name: 'Review ingredients for groceries' });
  const beansLine = review.getByRole('group', { name: `2 cups ${beans}` });
  const onionLine = review.getByRole('group', { name: `1 ${onion}` });
  const basilLine = review.getByRole('group', { name: basil });
  await expect(beansLine.getByLabel('Item name')).toHaveValue(beans);
  await expect(beansLine.getByLabel('Quantity')).toHaveValue('2');
  await expect(beansLine.getByLabel('Unit')).toHaveValue('cups');
  await expect(onionLine).toContainText(`Already on your list: ${onion} (2)`);
  await expect(onionLine.getByRole('radio', { name: 'Skip this item' })).toBeChecked();
  await expect(basilLine.getByLabel('Item name')).toHaveValue(basil);
  await expect(basilLine.getByLabel('Quantity')).toHaveValue('');
  await page.screenshot({ path: testInfo.outputPath('ingredient-review-mobile.png'), fullPage: true });

  await beansLine.getByLabel('Quantity').fill('3');
  await beansLine.getByLabel('Unit').fill('cans');
  await onionLine.getByRole('radio', { name: 'Keep separate duplicate' }).check();
  await basilLine.getByRole('radio', { name: 'Skip this item' }).check();
  await review.getByRole('button', { name: 'Add reviewed items' }).click();

  await expect(page.getByRole('status').filter({ hasText: /^Added 2 items and skipped 1\.$/ })).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: beans })).toContainText('3 cans');
  await expect(page.getByRole('article').filter({ hasText: onion })).toHaveCount(2);
  await expect(page.getByRole('article').filter({ hasText: basil })).toHaveCount(0);
});

test('reviewed ingredient edits work without JavaScript', async ({ page, browser }) => {
  const stamp = Date.now();
  const beans = `synthetic native beans ${stamp}`;
  const basil = `Fresh synthetic native basil ${stamp}`;
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await page.goto('/meals?date=2099-09-02');
  await page.getByText('Add a meal', { exact: true }).click();
  const addMeal = page.getByRole('form', { name: 'Add meal' });
  await addMeal.getByLabel('Meal name').fill(`Synthetic native dinner ${stamp}`);
  await addMeal.getByLabel('Ingredients').fill(`2 cups ${beans}\n${basil}`);
  await addMeal.getByRole('button', { name: 'Save meal' }).click();
  await expect(page.getByRole('article').filter({ hasText: `Synthetic native dinner ${stamp}` })).toBeVisible();

  const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState() });
  try {
    const native = await context.newPage();
    await native.goto('/meals?date=2099-09-02');
    const meal = native.getByRole('article').filter({ hasText: `Synthetic native dinner ${stamp}` });
    await meal.getByText('Add ingredients to groceries', { exact: true }).click();
    const ingredients = meal.getByRole('form', { name: `Add ingredients for Synthetic native dinner ${stamp}` });
    await ingredients.getByLabel(`2 cups ${beans}`).check();
    await ingredients.getByRole('button', { name: 'Review selected ingredients' }).click();
    const review = native.getByRole('region', { name: 'Review ingredients for groceries' });
    const line = review.getByRole('group', { name: `2 cups ${beans}` });
    await line.getByLabel('Quantity').fill('4');
    await line.getByLabel('Unit').fill('cups');
    await review.getByRole('button', { name: 'Add reviewed items' }).click();
    await expect(native.getByRole('status').filter({ hasText: /^Added 1 item and skipped 0\.$/ })).toBeVisible();
    await expect(native.getByRole('article').filter({ hasText: beans })).toContainText('4 cups');
    await expect(native.getByRole('article').filter({ hasText: basil })).toHaveCount(0);
  } finally { await context.close(); }
});

test('review edits survive delayed hydration', async ({ page, browser }) => {
  const stamp = Date.now();
  const beans = `synthetic delayed beans ${stamp}`;
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await page.goto('/meals?date=2099-09-03');
  await page.getByText('Add a meal', { exact: true }).click();
  const addMeal = page.getByRole('form', { name: 'Add meal' });
  await addMeal.getByLabel('Meal name').fill(`Synthetic delayed dinner ${stamp}`);
  await addMeal.getByLabel('Ingredients').fill(`2 cups ${beans}`);
  await addMeal.getByRole('button', { name: 'Save meal' }).click();
  await expect(page.getByRole('article').filter({ hasText: `Synthetic delayed dinner ${stamp}` })).toBeVisible();

  const context = await browser.newContext({ storageState: await page.context().storageState() });
  let release!: () => void, firstRequest!: () => void, secondRequest!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = new Promise<void>(resolve => { firstRequest = resolve; });
  const second = new Promise<void>(resolve => { secondRequest = resolve; });
  let requests = 0;
  try {
    const delayed = await context.newPage();
    await delayed.route('**/src/routes/meals/+page.svelte*', async route => {
      requests += 1;
      if (requests === 1) firstRequest();
      if (requests === 2) secondRequest();
      await gate;
      await route.continue();
    });
    await delayed.goto('/meals?date=2099-09-03', { waitUntil: 'commit' });
    await first;
    const meal = delayed.getByRole('article').filter({ hasText: `Synthetic delayed dinner ${stamp}` });
    await meal.getByText('Add ingredients to groceries', { exact: true }).click();
    const ingredients = meal.getByRole('form', { name: `Add ingredients for Synthetic delayed dinner ${stamp}` });
    await ingredients.getByLabel(`2 cups ${beans}`).check();
    await ingredients.getByRole('button', { name: 'Review selected ingredients' }).click();
    await second;
    const review = delayed.getByRole('region', { name: 'Review ingredients for groceries' });
    const line = review.getByRole('group', { name: `2 cups ${beans}` });
    await line.getByLabel('Quantity').fill('5');
    await line.getByLabel('Unit').fill('cans');
    release();
    await delayed.waitForLoadState('networkidle');
    expect(await review.evaluate(element => Object.fromEntries(new FormData(element.querySelector('form') as HTMLFormElement)))).toMatchObject({ 'name-0': beans, 'quantity-0': '5', 'unit-0': 'cans' });
    await review.getByRole('button', { name: 'Add reviewed items' }).click();
    await expect(delayed.getByRole('article').filter({ hasText: beans })).toContainText('5 cans');
  } finally { release(); await context.close(); }
});

for (const javaScriptEnabled of [true, false]) test(`reviewed ingredient validation preserves edits (JavaScript ${javaScriptEnabled ? 'on' : 'off'})`, async ({ page, browser }) => {
  const stamp = Date.now();
  const onion = `synthetic validated onion ${stamp}`;
  const date = '2099-09-04';
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await page.goto(`/meals?date=${date}`);
  await page.getByText('Add a meal', { exact: true }).click();
  const addMeal = page.getByRole('form', { name: 'Add meal' });
  await addMeal.getByLabel('Meal name').fill(`Synthetic validated dinner ${stamp}`);
  await addMeal.getByLabel('Ingredients').fill(`1 ${onion}`);
  await addMeal.getByRole('button', { name: 'Save meal' }).click();
  await expect(page.getByRole('article').filter({ hasText: `Synthetic validated dinner ${stamp}` })).toBeVisible();

  const context = await browser.newContext({ javaScriptEnabled, storageState: await page.context().storageState() });
  try {
    const view = await context.newPage();
    await view.goto(`/meals?date=${date}`);
    const meal = view.getByRole('article').filter({ hasText: `Synthetic validated dinner ${stamp}` });
    await meal.getByText('Add ingredients to groceries', { exact: true }).click();
    const ingredients = meal.getByRole('form', { name: `Add ingredients for Synthetic validated dinner ${stamp}` });
    await ingredients.getByLabel(`1 ${onion}`).check();
    await ingredients.getByRole('button', { name: 'Review selected ingredients' }).click();
    const review = view.getByRole('region', { name: 'Review ingredients for groceries' });
    const line = review.getByRole('group', { name: `1 ${onion}` });
    await line.getByLabel('Item name').fill('   ');
    await line.getByLabel('Quantity').fill('4');
    await line.getByLabel('Unit').fill('bags');
    await review.getByRole('button', { name: 'Add reviewed items' }).click();
    await expect(view.getByRole('status')).toContainText('Check each item name');
    await expect(review).toBeVisible();
    await expect(line.getByLabel('Quantity')).toHaveValue('4');
    await expect(line.getByLabel('Unit')).toHaveValue('bags');
    await line.getByLabel('Item name').fill(`synthetic corrected onion ${stamp}`);
    await review.getByRole('button', { name: 'Add reviewed items' }).click();
    await expect(view.getByRole('status').filter({ hasText: /^Added 1 item and skipped 0\.$/ })).toBeVisible();
    await expect(view.getByRole('article').filter({ hasText: `synthetic corrected onion ${stamp}` })).toContainText('4 bags');
  } finally { await context.close(); }
});

test('a grocery change during review asks for an explicit duplicate decision', async ({ page, browser }) => {
  const stamp = Date.now();
  const beans = `synthetic race beans ${stamp}`;
  const date = '2099-09-05';
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await page.goto(`/meals?date=${date}`);
  await page.getByText('Add a meal', { exact: true }).click();
  const addMeal = page.getByRole('form', { name: 'Add meal' });
  await addMeal.getByLabel('Meal name').fill(`Synthetic race dinner ${stamp}`);
  await addMeal.getByLabel('Ingredients').fill(`2 cups ${beans}`);
  await addMeal.getByRole('button', { name: 'Save meal' }).click();
  const meal = page.getByRole('article').filter({ hasText: `Synthetic race dinner ${stamp}` });
  await expect(meal).toBeVisible();
  await meal.getByText('Add ingredients to groceries', { exact: true }).click();
  const ingredients = meal.getByRole('form', { name: `Add ingredients for Synthetic race dinner ${stamp}` });
  await ingredients.getByLabel(`2 cups ${beans}`).check();
  await ingredients.getByRole('button', { name: 'Review selected ingredients' }).click();
  const review = page.getByRole('region', { name: 'Review ingredients for groceries' });
  const line = review.getByRole('group', { name: `2 cups ${beans}` });
  await line.getByLabel('Quantity').fill('4');

  const context = await browser.newContext({ storageState: await page.context().storageState() });
  try {
    const other = await context.newPage();
    await other.goto('/groceries');
    const addItem = other.getByRole('form', { name: 'Add grocery item' });
    await addItem.getByLabel('Item', { exact: true }).fill(beans);
    await addItem.getByLabel('Quantity', { exact: true }).fill('1');
    await addItem.getByRole('button', { name: 'Add item' }).click();
    await expect(other.getByRole('article').filter({ hasText: beans })).toContainText('1');

    await review.getByRole('button', { name: 'Add reviewed items' }).click();
    await expect(page.getByRole('status')).toContainText('now matches the grocery list');
    await expect(line.getByLabel('Quantity')).toHaveValue('4');
    await expect(line.getByRole('radio', { name: 'Skip this item' })).toBeChecked();
    await line.getByRole('radio', { name: 'Keep separate duplicate' }).check();
    await review.getByRole('button', { name: 'Add reviewed items' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^Added 1 item and skipped 0\.$/ })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: beans })).toHaveCount(2);
    await expect(page.getByRole('article').filter({ hasText: beans }).filter({ hasText: '4 cups' })).toHaveCount(1);
  } finally { await context.close(); }
});

test('a shared meal becomes a household grocery task without exposing private notes', async ({ page, browser }, testInfo) => {
  const title = `Family grocery dinner ${testInfo.repeatEachIndex}`;
  const selected = `2 bags family lentils ${testInfo.repeatEachIndex}`;
  const unselected = `1 family carrot ${testInfo.repeatEachIndex}`;
  const note = `Private dinner note ${testInfo.repeatEachIndex}`;
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await page.goto('/meals?date=2099-06-02');
  await page.getByText('Add a meal', { exact: true }).click();
  const add = page.getByRole('form', { name: 'Add meal' });
  await add.getByLabel('Meal name').fill(title);
  await add.getByLabel('Ingredients').fill(`${selected}\n${unselected}`);
  await add.getByLabel('Private notes (optional)').fill(note);
  await add.getByLabel('Share on family display').check();
  await add.getByRole('button', { name: 'Save meal' }).click();
  const meal = page.getByRole('article').filter({ hasText: title });
  await expect(meal).toContainText(note);
  await meal.getByText('Add ingredients to groceries', { exact: true }).click();
  const ingredients = meal.getByRole('form', { name: `Add ingredients for ${title}` });
  await ingredients.getByLabel(selected, { exact: true }).check();
  await ingredients.getByRole('button', { name: 'Review selected ingredients' }).click();
  const review = page.getByRole('region', { name: 'Review ingredients for groceries' });
  await expect(review.getByRole('group', { name: selected })).toContainText('Family-entered ingredients');
  await review.getByRole('button', { name: 'Add reviewed items' }).click();
  const parentItem = page.getByRole('article').filter({ hasText: selected });
  await expect(parentItem).toContainText('To buy');
  await expect(page.getByRole('article').filter({ hasText: unselected })).toHaveCount(0);

  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  try {
    const kid = await context.newPage();
    await kid.goto('/sign-in');
    await kid.getByLabel('Email').fill('kid@example.test');
    await kid.getByLabel('Password').fill('synthetic-kid-password');
    await kid.getByRole('button', { name: 'Sign in' }).click();
    await expect(kid.getByRole('heading', { name: "Sample Kid's My Day" })).toBeVisible();
    await kid.goto('/meals?date=2099-06-02');
    await expect(kid.getByRole('article').filter({ hasText: title })).toContainText(selected);
    expect(await kid.content()).not.toContain(note);
    await kid.goto('/groceries');
    const kidItem = kid.getByRole('article').filter({ hasText: selected });
    await expect(kidItem).toContainText('To buy');
    await expect(kid.getByRole('article').filter({ hasText: unselected })).toHaveCount(0);
    await kidItem.getByRole('button', { name: 'Mark bought' }).click();
    await expect(kidItem).toContainText('Bought');
    await page.reload();
    await expect(parentItem).toContainText('Bought');
  } finally { await context.close(); }
});

test('meal ingredient selections survive delayed hydration and submit the selected lines', async ({ page, browser }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await page.goto('/meals?date=2099-07-01');
  await page.getByText('Add a meal', { exact: true }).click();
  const add = page.getByRole('form', { name: 'Add meal' });
  await add.getByLabel('Meal name').fill('Synthetic early ingredient meal');
  await add.getByLabel('Ingredients').fill('2 cups synthetic early rice\n1 synthetic early carrot');
  await add.getByRole('button', { name: 'Save meal' }).click();
  await expect(page.getByRole('article').filter({ hasText: 'Synthetic early ingredient meal' })).toBeVisible();
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  let release!: () => void, requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const blocked = new Promise<void>(resolve => { requested = resolve; });
  try {
    const delayed = await context.newPage();
    await delayed.route('**/src/routes/meals/+page.svelte*', async route => { requested(); await gate; await route.continue(); });
    await delayed.goto('/meals?date=2099-07-01', { waitUntil: 'commit' }); await blocked;
    await delayed.getByLabel('Choose a date').fill('2099-07-02');
    const meal = delayed.getByRole('article').filter({ hasText: 'Synthetic early ingredient meal' });
    await meal.getByText('Add ingredients to groceries', { exact: true }).click();
    const ingredients = meal.getByRole('form', { name: 'Add ingredients for Synthetic early ingredient meal' });
    await ingredients.getByLabel('2 cups synthetic early rice').check();
    release(); await delayed.waitForLoadState('networkidle');
    await expect(delayed.getByLabel('Choose a date')).toHaveValue('2099-07-02');
    expect(await delayed.getByLabel('Choose a date').evaluate(element => new FormData((element as HTMLInputElement).form!).get('date'))).toBe('2099-07-02');
    await expect(ingredients).toBeVisible();
    expect(await ingredients.evaluate(element => new FormData(element as HTMLFormElement).getAll('ingredient'))).toEqual(['family:0']);
    await ingredients.getByRole('button', { name: 'Review selected ingredients' }).click();
    const review = delayed.getByRole('region', { name: 'Review ingredients for groceries' });
    const line = review.getByRole('group', { name: '2 cups synthetic early rice' });
    await expect(line.getByLabel('Item name')).toHaveValue('synthetic early rice');
    await expect(line.getByLabel('Quantity')).toHaveValue('2');
    await expect(line.getByLabel('Unit')).toHaveValue('cups');
    await review.getByRole('button', { name: 'Add reviewed items' }).click();
    await expect(delayed.getByRole('article').filter({ hasText: 'synthetic early rice' })).toContainText('2 cups');
  } finally { release(); await context.close(); }
});

test('grocery edits survive delayed hydration and are submitted', async ({ page, browser }) => {
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
    await delayed.route('**/src/routes/groceries/+page.svelte*', async route => { requested(); await gate; await route.continue(); });
    await delayed.goto('/groceries', { waitUntil: 'commit' });
    await blocked;
    const add = delayed.getByRole('form', { name: 'Add grocery item' });
    await add.getByLabel('Item', { exact: true }).fill('Synthetic early pears');
    await add.getByLabel('Quantity', { exact: true }).fill('3');
    await add.getByLabel('Unit', { exact: true }).fill('bags');
    release(); await delayed.waitForLoadState('networkidle');
    expect(await add.evaluate(element => Object.fromEntries(new FormData(element as HTMLFormElement)))).toMatchObject({ name: 'Synthetic early pears', quantity: '3', unit: 'bags' });
    await add.getByRole('button', { name: 'Add item' }).click();
    await expect(delayed.getByRole('article').filter({ hasText: 'Synthetic early pears' })).toContainText('3 bags');
  } finally { release(); await context.close(); }
});

test('a prefilled grocery edit and open disclosure survive delayed hydration', async ({ page, browser }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await page.goto('/groceries');
  const add = page.getByRole('form', { name: 'Add grocery item' });
  await add.getByLabel('Item', { exact: true }).fill('Synthetic prefilled rice');
  await add.getByLabel('Quantity', { exact: true }).fill('1');
  await add.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByRole('article').filter({ hasText: 'Synthetic prefilled rice' })).toBeVisible();
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  let release!: () => void, requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const blocked = new Promise<void>(resolve => { requested = resolve; });
  try {
    const delayed = await context.newPage();
    await delayed.route('**/src/routes/groceries/+page.svelte*', async route => { requested(); await gate; await route.continue(); });
    await delayed.goto('/groceries', { waitUntil: 'commit' }); await blocked;
    const item = delayed.getByRole('article').filter({ hasText: 'Synthetic prefilled rice' });
    await item.getByText('Edit item', { exact: true }).click();
    const edit = item.getByRole('form', { name: 'Edit Synthetic prefilled rice' });
    await edit.getByLabel('Unit', { exact: true }).fill('bags');
    const quantity = edit.getByLabel('Quantity', { exact: true });
    await quantity.focus();
    await quantity.evaluate((input: HTMLInputElement) => input.select());
    release(); await delayed.waitForLoadState('networkidle');
    await delayed.keyboard.insertText('3');
    await expect(edit).toBeVisible();
    expect(await edit.evaluate(element => Object.fromEntries(new FormData(element as HTMLFormElement)))).toMatchObject({ name: 'Synthetic prefilled rice', quantity: '3', unit: 'bags' });
    await edit.getByRole('button', { name: 'Save item' }).click();
    await expect(item).toContainText('3 bags');
  } finally { release(); await context.close(); }
});

test('grocery routes enforce sessions and origin checks', async ({ page }) => {
  expect((await page.request.get('/groceries', { maxRedirects: 0 })).status()).toBe(303);
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('kid@example.test');
  await page.getByLabel('Password').fill('synthetic-kid-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: "Sample Kid's My Day" })).toBeVisible();
  const response = await page.request.post('/groceries?/add', { form: { name: 'Synthetic blocked', quantity: '1', unit: '' }, headers: { origin: 'https://other.example.test' } });
  expect(response.status()).toBe(403);
  const view = await page.goto('/groceries');
  expect(view?.headers()['cache-control']).toContain('no-store');
  const add = page.getByRole('form', { name: 'Add grocery item' });
  await add.getByLabel('Item', { exact: true }).fill('Synthetic kid item');
  await add.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByRole('article').filter({ hasText: 'Synthetic kid item' })).toBeVisible();
});

test('the grocery data endpoint requires a session and never crosses households', async ({ page, browser }) => {
  const name = `Synthetic endpoint oats ${Date.now()}`;
  await signIn(page);
  await page.goto('/groceries');
  const add = page.getByRole('form', { name: 'Add grocery item' });
  await add.getByLabel('Item', { exact: true }).fill(name);
  await add.getByLabel('Quantity', { exact: true }).fill('2');
  await add.getByRole('button', { name: 'Add item' }).click();
  const article = page.getByRole('article').filter({ hasText: name });
  await expect(article).toContainText('2');
  const origin = 'http://127.0.0.1:4173';

  const anonymous = await browser.newContext();
  try {
    const response = await anonymous.request.get(`${origin}/groceries/data`);
    expect(response.status()).toBe(401);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(await response.json()).toEqual({ error: 'unauthenticated' });
  } finally { await anonymous.close(); }

  const kidContext = await browser.newContext();
  try {
    const login = await kidContext.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'kid@example.test', password: 'synthetic-kid-password' } });
    expect(login.status()).toBe(200);
    const response = await kidContext.request.get(`${origin}/groceries/data`);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    const body = await response.json() as { items: Record<string, unknown>[] };
    const item = body.items.find(value => value.name === name);
    expect(item).toMatchObject({ name, quantity: '2', unit: '', completed: false });
    expect(Object.keys(item ?? {}).sort()).toEqual(['completed', 'id', 'name', 'quantity', 'unit', 'version']);
  } finally { await kidContext.close(); }

  const otherContext = await browser.newContext();
  try {
    const login = await otherContext.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'other-parent@example.test', password: 'synthetic-other-parent-password' } });
    expect(login.status()).toBe(200);
    const response = await otherContext.request.get(`${origin}/groceries/data`);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    const body = await response.json() as { items: { name: string }[] };
    expect(body.items.some(value => value.name === name)).toBe(false);
  } finally { await otherContext.close(); }
});

test('a disabled household member is denied grocery data instead of looking like a temporary outage', async ({ browser }) => {
  const origin = 'http://127.0.0.1:4173';
  const context = await browser.newContext();
  try {
    const login = await context.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'disabled-grocery@example.test', password: 'synthetic-disabled-grocery-password' } });
    expect(login.status()).toBe(200);
    const response = await context.request.get(`${origin}/groceries/data`);
    expect(response.status()).toBe(403);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(await response.json()).toEqual({ error: 'forbidden' });
    expect((await context.request.get(`${origin}/groceries`)).status()).toBe(403);
  } finally { await context.close(); }
});

for (const javaScriptEnabled of [true, false]) test(`invalid grocery item can be corrected (JavaScript ${javaScriptEnabled ? 'on' : 'off'})`, async ({ page, browser }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  const context = await browser.newContext({ javaScriptEnabled, storageState: await page.context().storageState() });
  try {
    const view = await context.newPage();
    await view.goto('/groceries');
    const add = view.getByRole('form', { name: 'Add grocery item' });
    await add.getByLabel('Item', { exact: true }).fill('   ');
    await add.getByLabel('Quantity', { exact: true }).fill('4');
    await add.getByRole('button', { name: 'Add item' }).click();
    const liveUpdates = view.getByRole('status').filter({ hasText: /^Updates paused while you edit\.$/ });
    if (javaScriptEnabled) await expect(liveUpdates).toBeVisible();
    else await expect(liveUpdates).toHaveCount(0);
    await expect(view.getByRole('status').filter({ hasText: /^Check the item name and details\.$/ })).toBeVisible();
    await expect(add.getByLabel('Quantity', { exact: true })).toHaveValue('4');
    await add.getByLabel('Item', { exact: true }).fill(`Synthetic corrected ${javaScriptEnabled}`);
    await add.getByRole('button', { name: 'Add item' }).click();
    await expect(view.getByRole('article').filter({ hasText: `Synthetic corrected ${javaScriptEnabled}` })).toBeVisible();
  } finally { await context.close(); }
});

test('a stale edit does not overwrite another household session', async ({ page, browser }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await page.goto('/groceries');
  const add = page.getByRole('form', { name: 'Add grocery item' });
  await add.getByLabel('Item', { exact: true }).fill('Synthetic shared oats');
  await add.getByRole('button', { name: 'Add item' }).click();
  const item = page.getByRole('article').filter({ hasText: 'Synthetic shared oats' });
  await expect(item).toBeVisible();
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  try {
    const other = await context.newPage(); await other.goto('/groceries');
    const otherItem = other.getByRole('article').filter({ hasText: 'Synthetic shared oats' });
    await otherItem.getByText('Edit item', { exact: true }).click();
    const stale = otherItem.getByRole('form', { name: 'Edit Synthetic shared oats' });
    await stale.getByLabel('Quantity', { exact: true }).fill('3');
    await item.getByRole('button', { name: 'Mark bought' }).click();
    await expect(item).toContainText('Bought');
    await stale.getByRole('button', { name: 'Save item' }).click();
    await expect(other.getByRole('status').filter({ hasText: 'This item could not be saved. It may have changed' })).toBeVisible();
    await expect(stale.getByLabel('Quantity', { exact: true })).toHaveValue('3');
    await stale.getByRole('button', { name: 'Save item' }).click();
    await expect(other.getByRole('status').filter({ hasText: 'This item could not be saved. It may have changed' })).toBeVisible();
    await other.reload();
    await expect(otherItem).toContainText('Bought');
  } finally { await context.close(); }
});

test('a visible grocery list receives additions, completions and removals from another session', async ({ page, browser }) => {
  const name = 'Synthetic live rye';
  await signIn(page);
  const otherContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    await page.clock.install();
    await page.goto('/groceries');
    await expect(page.getByText('Live updates on.')).toBeVisible();
    const other = await otherContext.newPage();
    await other.goto('/groceries');
    const otherAdd = other.getByRole('form', { name: 'Add grocery item' });
    await otherAdd.getByLabel('Item', { exact: true }).fill(name);
    await otherAdd.getByLabel('Quantity', { exact: true }).fill('2');
    await otherAdd.getByLabel('Unit', { exact: true }).fill('loaves');
    await otherAdd.getByRole('button', { name: 'Add item' }).click();
    await expect(other.getByRole('article').filter({ hasText: name })).toContainText('2 loaves');
    const item = page.getByRole('article').filter({ hasText: name });
    await expect(item).toHaveCount(0);
    await page.evaluate(() => { (window as unknown as { __manualRefreshMarker?: boolean }).__manualRefreshMarker = true; });
    await page.getByRole('link', { name: 'Refresh list' }).click();
    await expect(item).toContainText('2 loaves');
    expect(await page.evaluate(() => (window as unknown as { __manualRefreshMarker?: boolean }).__manualRefreshMarker)).toBe(true);

    await other.getByRole('article').filter({ hasText: name }).getByRole('button', { name: 'Mark bought' }).click();
    await expect(other.getByRole('article').filter({ hasText: name })).toContainText('Bought');
    await page.clock.runFor(25_000);
    await expect(item).toContainText('Bought');

    await other.getByRole('article').filter({ hasText: name }).getByRole('button', { name: 'Remove item' }).click();
    await expect(other.getByRole('article').filter({ hasText: name })).toHaveCount(0);
    await page.clock.runFor(25_000);
    await expect(item).toHaveCount(0);
  } finally { await otherContext.close(); }
});

test('automatic updates pause for add and edit drafts and resume when editing ends', async ({ page, browser }) => {
  const base = 'Synthetic live pears';
  const oranges = 'Synthetic live oranges';
  const kiwis = 'Synthetic live kiwis';
  await signIn(page);
  const otherContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    await page.clock.install();
    await page.goto('/groceries');
    await expect(page.getByText('Live updates on.')).toBeVisible();
    const add = page.getByRole('form', { name: 'Add grocery item' });
    await add.getByLabel('Item', { exact: true }).fill(base);
    await add.getByLabel('Quantity', { exact: true }).fill('2');
    await add.getByRole('button', { name: 'Add item' }).click();
    const baseItem = page.getByRole('article').filter({ hasText: base });
    await expect(baseItem).toContainText('2');

    const other = await otherContext.newPage();
    await other.goto('/groceries');
    const otherAdd = other.getByRole('form', { name: 'Add grocery item' });
    await otherAdd.getByLabel('Item', { exact: true }).fill(oranges);
    await otherAdd.getByRole('button', { name: 'Add item' }).click();
    await expect(other.getByRole('article').filter({ hasText: oranges })).toBeVisible();

    await add.getByLabel('Item', { exact: true }).fill('Synthetic draft plums');
    await add.getByLabel('Quantity', { exact: true }).fill('4');
    await page.getByRole('link', { name: 'Refresh list' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Finish or clear your changes before refreshing.' })).toBeVisible();
    await page.clock.runFor(25_000);
    await expect(page.getByRole('article').filter({ hasText: oranges })).toHaveCount(0);
    await expect(add.getByLabel('Item', { exact: true })).toHaveValue('Synthetic draft plums');
    await expect(add.getByLabel('Quantity', { exact: true })).toHaveValue('4');
    await expect(page.getByRole('status').filter({ hasText: 'Updates paused while you edit.' })).toBeVisible();

    await add.getByLabel('Item', { exact: true }).fill('');
    await add.getByLabel('Quantity', { exact: true }).fill('');
    await page.clock.runFor(25_000);
    await expect(page.getByRole('article').filter({ hasText: oranges })).toBeVisible();

    await baseItem.getByText('Edit item', { exact: true }).click();
    const edit = baseItem.getByRole('form', { name: `Edit ${base}` });
    await edit.getByLabel('Quantity', { exact: true }).fill('7');
    await otherAdd.getByLabel('Item', { exact: true }).fill(kiwis);
    await otherAdd.getByRole('button', { name: 'Add item' }).click();
    await expect(other.getByRole('article').filter({ hasText: kiwis })).toBeVisible();
    await page.clock.runFor(25_000);
    await expect(page.getByRole('article').filter({ hasText: kiwis })).toHaveCount(0);
    await expect(edit.getByLabel('Quantity', { exact: true })).toHaveValue('7');
    await expect(edit).toBeVisible();
    await page.getByRole('link', { name: 'Refresh list' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Finish or clear your changes before refreshing.' })).toBeVisible();

    await baseItem.getByText('Edit item', { exact: true }).click();
    await expect(edit).toBeHidden();
    await page.clock.runFor(25_000);
    await expect(page.getByRole('article').filter({ hasText: kiwis })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Live updates on.' })).toBeVisible();
  } finally { await otherContext.close(); }
});

test('live updates stop while the tab is hidden and refresh when it becomes visible', async ({ page, browser }) => {
  const name = 'Synthetic hidden plums';
  await signIn(page);
  await page.addInitScript(() => {
    const state = window as unknown as { __groceryHidden?: boolean; __setGroceryHidden?: (hidden: boolean) => void };
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state.__groceryHidden ? 'hidden' : 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => Boolean(state.__groceryHidden) });
    state.__setGroceryHidden = (hidden: boolean) => {
      state.__groceryHidden = hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });
  const otherContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    await page.clock.install();
    await page.goto('/groceries');
    await expect(page.getByText('Live updates on.')).toBeVisible();
    const other = await otherContext.newPage();
    await other.goto('/groceries');
    const otherAdd = other.getByRole('form', { name: 'Add grocery item' });
    await otherAdd.getByLabel('Item', { exact: true }).fill(name);
    await otherAdd.getByRole('button', { name: 'Add item' }).click();
    await expect(other.getByRole('article').filter({ hasText: name })).toBeVisible();

    await page.evaluate(() => (window as unknown as { __setGroceryHidden: (hidden: boolean) => void }).__setGroceryHidden(true));
    await page.clock.runFor(25_000);
    await expect(page.getByRole('article').filter({ hasText: name })).toHaveCount(0);

    await page.evaluate(() => (window as unknown as { __setGroceryHidden: (hidden: boolean) => void }).__setGroceryHidden(false));
    await expect(page.getByRole('article').filter({ hasText: name })).toBeVisible();
  } finally { await otherContext.close(); }
});

test('leaving the page disposes the live refresh timer', async ({ page }) => {
  await signIn(page);
  await page.clock.install();
  await page.goto('/groceries');
  await expect(page.getByText('Live updates on.')).toBeVisible();
  let dataRequests = 0;
  page.on('request', request => { if (request.url().includes('/groceries/data')) dataRequests++; });
  await page.getByRole('link', { name: 'Back to home' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  const requestsAfterNavigation = dataRequests;
  await page.clock.runFor(75_000);
  expect(dataRequests).toBe(requestsAfterNavigation);
});

test('live refresh does not start another request while one is still running', async ({ page }) => {
  await signIn(page);
  await page.clock.install();
  await page.goto('/groceries');
  await expect(page.getByText('Live updates on.')).toBeVisible();
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/groceries/data', async route => {
    requests++;
    if (requests === 1) { started(); await gate; }
    await route.continue();
  });
  await page.clock.runFor(25_000);
  await firstStarted;
  expect(requests).toBe(1);
  await page.clock.runFor(5_000);
  expect(requests).toBe(1);
  const completed = page.waitForResponse(response => response.url().includes('/groceries/data'));
  release();
  await completed;
  await expect(page.getByText('Live updates on.')).toBeVisible();
  await page.clock.runFor(25_000);
  await expect.poll(() => requests).toBe(2);
});

test('an edit typed during a slow refresh survives the arriving server data', async ({ page, browser }) => {
  const base = 'Synthetic live oat bread';
  await signIn(page);
  const otherContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    await page.clock.install();
    await page.goto('/groceries');
    await expect(page.getByText('Live updates on.')).toBeVisible();
    const add = page.getByRole('form', { name: 'Add grocery item' });
    await add.getByLabel('Item', { exact: true }).fill(base);
    await add.getByRole('button', { name: 'Add item' }).click();
    const baseItem = page.getByRole('article').filter({ hasText: base });
    await expect(baseItem).toBeVisible();
    await baseItem.getByText('Edit item', { exact: true }).click();
    const edit = baseItem.getByRole('form', { name: `Edit ${base}` });

    const other = await otherContext.newPage();
    await other.goto('/groceries');
    const otherItem = other.getByRole('article').filter({ hasText: base });
    await otherItem.getByText('Edit item', { exact: true }).click();
    const otherEdit = otherItem.getByRole('form', { name: `Edit ${base}` });

    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void;
    const firstStarted = new Promise<void>(resolve => { started = resolve; });
    await page.route('**/groceries/data', async route => {
      started();
      await gate;
      await route.continue();
    });
    await page.clock.runFor(25_000);
    await firstStarted;
    await edit.getByLabel('Quantity', { exact: true }).fill('7');
    await otherEdit.getByLabel('Quantity', { exact: true }).fill('5');
    await otherEdit.getByRole('button', { name: 'Save item' }).click();
    await expect(otherItem).toContainText('5');
    release();
    await expect(edit.getByLabel('Quantity', { exact: true })).toHaveValue('7');
    await expect(edit).toBeVisible();

    await baseItem.getByText('Edit item', { exact: true }).click();
    await expect(edit).toBeHidden();
    await baseItem.getByText('Edit item', { exact: true }).click();
    await expect(edit.getByLabel('Quantity', { exact: true })).toHaveValue('5');
  } finally { await otherContext.close(); }
});

test('an unreachable server while the browser is online keeps the current list and recovers', async ({ page, browser }) => {
  const base = 'Synthetic outage beans';
  const remote = 'Synthetic outage rice';
  await signIn(page);
  const otherContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    await page.clock.install();
    await page.goto('/groceries');
    await expect(page.getByText('Live updates on.')).toBeVisible();
    const add = page.getByRole('form', { name: 'Add grocery item' });
    await add.getByLabel('Item', { exact: true }).fill(base);
    await add.getByRole('button', { name: 'Add item' }).click();
    await expect(page.getByRole('article').filter({ hasText: base })).toBeVisible();
    await expect(page.getByText('Live updates on.')).toBeVisible();

    const other = await otherContext.newPage();
    await other.goto('/groceries');
    const otherAdd = other.getByRole('form', { name: 'Add grocery item' });
    await otherAdd.getByLabel('Item', { exact: true }).fill(remote);
    await otherAdd.getByRole('button', { name: 'Add item' }).click();
    await expect(other.getByRole('article').filter({ hasText: remote })).toBeVisible();

    let serverReachable = false;
    await page.route('**/groceries/data', route => serverReachable ? route.continue() : route.abort('failed'));
    await page.clock.runFor(25_000);
    await expect(page.getByRole('status').filter({ hasText: 'Unable to refresh right now.' })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: base })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: remote })).toHaveCount(0);
    await expect(page.getByText('Live updates on.')).toHaveCount(0);

    serverReachable = true;
    await page.clock.runFor(25_000);
    await expect(page.getByRole('status').filter({ hasText: 'Live updates on.' })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: remote })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: base })).toBeVisible();
  } finally { await otherContext.close(); }
});

test('a temporary 503 keeps the current list and recovers on the next refresh', async ({ page, browser }) => {
  const base = 'Synthetic 503 oats';
  const remote = 'Synthetic 503 plums';
  await signIn(page);
  const otherContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    await page.clock.install();
    await page.goto('/groceries');
    await expect(page.getByText('Live updates on.')).toBeVisible();
    const add = page.getByRole('form', { name: 'Add grocery item' });
    await add.getByLabel('Item', { exact: true }).fill(base);
    await add.getByRole('button', { name: 'Add item' }).click();
    await expect(page.getByRole('article').filter({ hasText: base })).toBeVisible();
    await expect(page.getByText('Live updates on.')).toBeVisible();

    const other = await otherContext.newPage();
    await other.goto('/groceries');
    const otherAdd = other.getByRole('form', { name: 'Add grocery item' });
    await otherAdd.getByLabel('Item', { exact: true }).fill(remote);
    await otherAdd.getByRole('button', { name: 'Add item' }).click();
    await expect(other.getByRole('article').filter({ hasText: remote })).toBeVisible();

    let unavailable = true;
    await page.route('**/groceries/data', route => unavailable
      ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
      : route.continue());
    await page.clock.runFor(25_000);
    await expect(page.getByRole('status').filter({ hasText: 'Unable to refresh right now.' })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: base })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: remote })).toHaveCount(0);

    unavailable = false;
    await page.clock.runFor(25_000);
    await expect(page.getByRole('status').filter({ hasText: 'Live updates on.' })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: remote })).toBeVisible();
  } finally { await otherContext.close(); }
});

test('a refresh that exceeds its time limit keeps the current list', async ({ page }) => {
  await signIn(page);
  await page.clock.install();
  await page.goto('/groceries');
  await expect(page.getByText('Live updates on.')).toBeVisible();
  const add = page.getByRole('form', { name: 'Add grocery item' });
  await add.getByLabel('Item', { exact: true }).fill('Synthetic timeout bread');
  await add.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByRole('article').filter({ hasText: 'Synthetic timeout bread' })).toBeVisible();
  await expect(page.getByText('Live updates on.')).toBeVisible();

  let release!: () => void;
  const stalled = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/groceries/data', async route => {
    await stalled;
    await route.abort('failed').catch(() => {});
  });
  await page.clock.runFor(25_000);
  await page.clock.runFor(8_000);
  await expect(page.getByRole('status').filter({ hasText: 'Unable to refresh right now.' })).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'Synthetic timeout bread' })).toBeVisible();
  release();
});

test('repeated failed refreshes keep the list without reloading and recover once', async ({ page, browser }) => {
  const base = 'Synthetic repeated outage beans';
  const remote = 'Synthetic repeated outage rice';
  await signIn(page);
  const otherContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    await page.clock.install();
    await page.goto('/groceries');
    await expect(page.getByText('Live updates on.')).toBeVisible();
    const add = page.getByRole('form', { name: 'Add grocery item' });
    await add.getByLabel('Item', { exact: true }).fill(base);
    await add.getByRole('button', { name: 'Add item' }).click();
    await expect(page.getByRole('article').filter({ hasText: base })).toBeVisible();
    await page.evaluate(() => { (window as unknown as { __outageMarker?: boolean }).__outageMarker = true; });

    const other = await otherContext.newPage();
    await other.goto('/groceries');
    const otherAdd = other.getByRole('form', { name: 'Add grocery item' });
    await otherAdd.getByLabel('Item', { exact: true }).fill(remote);
    await otherAdd.getByRole('button', { name: 'Add item' }).click();
    await expect(other.getByRole('article').filter({ hasText: remote })).toBeVisible();

    let requests = 0;
    await page.route('**/groceries/data', route => { requests++; return route.abort('failed'); });
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.clock.runFor(25_000);
      await expect.poll(() => requests).toBe(attempt);
      await expect(page.getByRole('status').filter({ hasText: 'Unable to refresh right now.' })).toBeVisible();
      await expect(page.getByRole('article').filter({ hasText: base })).toBeVisible();
      await expect(page.getByRole('article').filter({ hasText: remote })).toHaveCount(0);
    }
    expect(await page.evaluate(() => (window as unknown as { __outageMarker?: boolean }).__outageMarker)).toBe(true);
    await expect(page.getByText('Live updates on.')).toHaveCount(0);

    await page.unroute('**/groceries/data');
    await page.clock.runFor(25_000);
    await expect(page.getByRole('status').filter({ hasText: 'Live updates on.' })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: remote })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: base })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __outageMarker?: boolean }).__outageMarker)).toBe(true);
  } finally { await otherContext.close(); }
});

test('a remote removal of an open but unedited item explains the conflict before saving', async ({ page, browser }) => {
  const base = 'Synthetic clean conflict beans';
  await signIn(page);
  const otherContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    await page.clock.install();
    await page.goto('/groceries');
    await expect(page.getByText('Live updates on.')).toBeVisible();
    const add = page.getByRole('form', { name: 'Add grocery item' });
    await add.getByLabel('Item', { exact: true }).fill(base);
    await add.getByLabel('Quantity', { exact: true }).fill('2');
    await add.getByRole('button', { name: 'Add item' }).click();
    const item = page.getByRole('article').filter({ hasText: base });
    await expect(item).toContainText('2');
    await expect(page.getByText('Live updates on.')).toBeVisible();
    await item.getByText('Edit item', { exact: true }).click();
    const edit = item.getByRole('form', { name: `Edit ${base}` });
    await expect(edit).toBeVisible();

    const other = await otherContext.newPage();
    await other.goto('/groceries');
    await other.getByRole('article').filter({ hasText: base }).getByRole('button', { name: 'Remove item' }).click();
    await expect(other.getByRole('article').filter({ hasText: base })).toHaveCount(0);

    await page.clock.runFor(25_000);
    await expect(item).toBeVisible();
    await expect(edit).toBeVisible();
    await expect(item.getByRole('status')).toContainText('removed in another session');
    await expect(edit.getByLabel('Quantity', { exact: true })).toHaveValue('2');
  } finally { await otherContext.close(); }
});

test('a remote removal keeps the open edit draft and explains the conflict', async ({ page, browser }) => {
  const base = 'Synthetic conflicted beans';
  await signIn(page);
  const otherContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    await page.clock.install();
    await page.goto('/groceries');
    await expect(page.getByText('Live updates on.')).toBeVisible();
    const add = page.getByRole('form', { name: 'Add grocery item' });
    await add.getByLabel('Item', { exact: true }).fill(base);
    await add.getByLabel('Quantity', { exact: true }).fill('2');
    await add.getByRole('button', { name: 'Add item' }).click();
    const item = page.getByRole('article').filter({ hasText: base });
    await expect(item).toContainText('2');
    await expect(page.getByText('Live updates on.')).toBeVisible();
    await item.getByText('Edit item', { exact: true }).click();
    const edit = item.getByRole('form', { name: `Edit ${base}` });
    await edit.getByLabel('Quantity', { exact: true }).fill('7');

    const other = await otherContext.newPage();
    await other.goto('/groceries');
    await other.getByRole('article').filter({ hasText: base }).getByRole('button', { name: 'Remove item' }).click();
    await expect(other.getByRole('article').filter({ hasText: base })).toHaveCount(0);

    await edit.getByRole('button', { name: 'Save item' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'may have changed' })).toBeVisible();
    await expect(edit).toBeVisible();
    await expect(edit.getByLabel('Quantity', { exact: true })).toHaveValue('7');
    await expect(item.getByRole('status')).toContainText('removed in another session');
  } finally { await otherContext.close(); }
});

test('a forbidden refresh clears the list and stops protected updates', async ({ page }) => {
  await signIn(page);
  await page.clock.install();
  await page.goto('/groceries');
  await expect(page.getByText('Live updates on.')).toBeVisible();
  const add = page.getByRole('form', { name: 'Add grocery item' });
  await add.getByLabel('Item', { exact: true }).fill('Synthetic forbidden squash');
  await add.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByRole('article').filter({ hasText: 'Synthetic forbidden squash' })).toBeVisible();
  await expect(page.getByText('Live updates on.')).toBeVisible();

  let requests = 0;
  await page.route('**/groceries/data', route => {
    requests++;
    return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"forbidden"}' });
  });
  await page.clock.runFor(25_000);
  await expect(page.getByRole('status').filter({ hasText: 'no longer have access' })).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'Synthetic forbidden squash' })).toHaveCount(0);
  await page.clock.runFor(75_000);
  expect(requests).toBe(1);
});

test('an HTML sign-in response is treated as an expired session', async ({ page }) => {
  await signIn(page);
  await page.clock.install();
  await page.goto('/groceries');
  await expect(page.getByText('Live updates on.')).toBeVisible();
  await page.route('**/groceries/data', route => route.fulfill({ status: 303, headers: { location: '/sign-in' } }));
  await page.clock.runFor(25_000);
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('a failed refresh keeps the current list visible and recovers automatically', async ({ page, browser }) => {
  const base = 'Synthetic recovery beans';
  const remote = 'Synthetic recovery rice';
  await signIn(page);
  const otherContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    await page.clock.install();
    await page.goto('/groceries');
    await expect(page.getByText('Live updates on.')).toBeVisible();
    const add = page.getByRole('form', { name: 'Add grocery item' });
    await add.getByLabel('Item', { exact: true }).fill(base);
    await add.getByRole('button', { name: 'Add item' }).click();
    await expect(page.getByRole('article').filter({ hasText: base })).toBeVisible();

    const other = await otherContext.newPage();
    await other.goto('/groceries');
    const otherAdd = other.getByRole('form', { name: 'Add grocery item' });
    await otherAdd.getByLabel('Item', { exact: true }).fill(remote);
    await otherAdd.getByRole('button', { name: 'Add item' }).click();
    await expect(other.getByRole('article').filter({ hasText: remote })).toBeVisible();

    await page.context().setOffline(true);
    await page.clock.runFor(25_000);
    await expect(page.getByRole('status').filter({ hasText: 'Unable to refresh right now.' })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: base })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: remote })).toHaveCount(0);

    await page.context().setOffline(false);
    await expect(page.getByRole('status').filter({ hasText: 'Live updates on.' })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: remote })).toBeVisible();
  } finally { await otherContext.close(); }
});

test('an expired session returns to sign in instead of showing a stale live list', async ({ page }) => {
  await signIn(page);
  await page.clock.install();
  await page.goto('/groceries');
  await expect(page.getByText('Live updates on.')).toBeVisible();
  await page.context().clearCookies();
  await page.clock.runFor(25_000);
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('automatic updates can be paused and resumed', async ({ page, browser }) => {
  const name = 'Synthetic paused lentils';
  await signIn(page);
  const otherContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    await page.clock.install();
    await page.goto('/groceries');
    await expect(page.getByText('Live updates on.')).toBeVisible();
    await page.getByRole('button', { name: 'Pause automatic updates' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Automatic updates paused.' })).toBeVisible();

    const other = await otherContext.newPage();
    await other.goto('/groceries');
    const otherAdd = other.getByRole('form', { name: 'Add grocery item' });
    await otherAdd.getByLabel('Item', { exact: true }).fill(name);
    await otherAdd.getByRole('button', { name: 'Add item' }).click();
    await expect(other.getByRole('article').filter({ hasText: name })).toBeVisible();
    await page.clock.runFor(25_000);
    await expect(page.getByRole('article').filter({ hasText: name })).toHaveCount(0);

    await page.getByRole('button', { name: 'Resume automatic updates' }).click();
    await expect(page.getByRole('article').filter({ hasText: name })).toBeVisible();
  } finally { await otherContext.close(); }
});

test('a refresh keeps the reading position and focus stable', async ({ page, browser }) => {
  const base = 'Synthetic scroll lentils';
  const remote = 'Synthetic scroll rice';
  const later = 'Synthetic scroll oats';
  await signIn(page);
  await page.setViewportSize({ width: 375, height: 300 });
  const otherContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 300 } });
  try {
    await page.clock.install();
    await page.goto('/groceries');
    await expect(page.getByText('Live updates on.')).toBeVisible();
    const add = page.getByRole('form', { name: 'Add grocery item' });
    await add.getByLabel('Item', { exact: true }).fill(base);
    await add.getByRole('button', { name: 'Add item' }).click();
    await expect(page.getByRole('article').filter({ hasText: base })).toBeVisible();

    const other = await otherContext.newPage();
    await other.goto('/groceries');
    const otherAdd = other.getByRole('form', { name: 'Add grocery item' });
    await otherAdd.getByLabel('Item', { exact: true }).fill(remote);
    await otherAdd.getByRole('button', { name: 'Add item' }).click();
    await expect(other.getByRole('article').filter({ hasText: remote })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 200));
    const scrollPosition = await page.evaluate(() => window.scrollY);
    expect(scrollPosition).toBeGreaterThan(0);
    await page.clock.runFor(25_000);
    await expect(page.getByRole('article').filter({ hasText: remote })).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollPosition);

    await add.getByLabel('Item', { exact: true }).focus();
    await otherAdd.getByLabel('Item', { exact: true }).fill(later);
    await otherAdd.getByRole('button', { name: 'Add item' }).click();
    await expect(other.getByRole('article').filter({ hasText: later })).toBeVisible();
    await page.clock.runFor(25_000);
    await expect(page.getByRole('article').filter({ hasText: later })).toBeVisible();
    await expect(add.getByLabel('Item', { exact: true })).toBeFocused();
  } finally { await otherContext.close(); }
});

test('validation recovery keeps entered values and pauses refresh until corrected', async ({ page, browser }) => {
  const remote = 'Synthetic recovery squash';
  const corrected = 'Synthetic corrected squash';
  await signIn(page);
  const otherContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    await page.clock.install();
    await page.goto('/groceries');
    await expect(page.getByText('Live updates on.')).toBeVisible();
    const add = page.getByRole('form', { name: 'Add grocery item' });
    await add.getByLabel('Item', { exact: true }).fill('   ');
    await add.getByLabel('Quantity', { exact: true }).fill('4');
    await add.getByRole('button', { name: 'Add item' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Check the item name' })).toBeVisible();

    const other = await otherContext.newPage();
    await other.goto('/groceries');
    const otherAdd = other.getByRole('form', { name: 'Add grocery item' });
    await otherAdd.getByLabel('Item', { exact: true }).fill(remote);
    await otherAdd.getByRole('button', { name: 'Add item' }).click();
    await expect(other.getByRole('article').filter({ hasText: remote })).toBeVisible();

    await page.clock.runFor(25_000);
    await expect(page.getByRole('article').filter({ hasText: remote })).toHaveCount(0);
    await expect(add.getByLabel('Quantity', { exact: true })).toHaveValue('4');
    await expect(page.getByRole('status').filter({ hasText: 'Updates paused while you edit.' })).toBeVisible();

    await add.getByLabel('Item', { exact: true }).fill(corrected);
    await add.getByRole('button', { name: 'Add item' }).click();
    await expect(page.getByRole('article').filter({ hasText: corrected })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: remote })).toBeVisible();
  } finally { await otherContext.close(); }
});
