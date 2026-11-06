import { expect, test } from '@playwright/test';

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
  await expect(page.getByRole('status')).toContainText('Added 1 item and skipped 0');
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
  await expect(page.getByRole('status')).toContainText('Added 1 item and skipped 0');
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

  await expect(page.getByRole('status')).toContainText('Added 2 items and skipped 1');
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
    await expect(native.getByRole('status')).toContainText('Added 1 item and skipped 0');
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
    await expect(view.getByRole('status')).toContainText('Added 1 item and skipped 0');
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
    await expect(page.getByRole('status')).toContainText('Added 1 item and skipped 0');
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
    await expect(view.getByRole('status')).toContainText('Check the item name');
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
    await expect(other.getByRole('status')).toContainText('may have changed');
    await expect(stale.getByLabel('Quantity', { exact: true })).toHaveValue('3');
    await stale.getByRole('button', { name: 'Save item' }).click();
    await expect(other.getByRole('status')).toContainText('may have changed');
    await other.reload();
    await expect(otherItem).toContainText('Bought');
  } finally { await context.close(); }
});
