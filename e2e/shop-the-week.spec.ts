import { expect, test, type Page } from '@playwright/test';
import { hydrated, settle } from './support/navigation';
import { pageModule } from './support/modules';
import { freshHousehold, type SeededMember } from './support/households';

// e2e-isolation: fresh-households
// Every test shops for its own household's week, so meals, groceries and duplicates never collide
// with another test or a repetition of this one.

/** A parent, a second parent and a child; names match the headings the tests assert. */
function shoppingHousehold() {
  return freshHousehold({ members: [
    { name: 'Sample Parent', role: 'parent' }, { name: 'Multi Parent', role: 'parent' }, { name: 'Sample Kid', role: 'kid' }
  ] });
}

/** Signs in through the form and waits for that member's home page. */
async function signIn(page: Page, member: SeededMember) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(member.email);
  await page.getByLabel('Password').fill(member.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: member.role === 'parent' ? `Hello, ${member.name}` : `${member.name}'s My Day` })).toBeVisible();
}

function day(page: Page, date: string) {
  return page.getByRole('region', { name: `Meals for ${date}`, exact: true });
}

async function addMeal(page: Page, date: string, title: string, ingredients: string) {
  await page.goto(`/meals?date=${date}&plan=1`);
  const form = page.getByRole('form', { name: 'Add meal', exact: true });
  await form.getByLabel('Meal name').fill(title);
  await form.getByLabel('Ingredients').fill(ingredients);
  await form.getByRole('button', { name: 'Save meal' }).click();
  await expect(day(page, date).getByRole('article').filter({ hasText: title })).toBeVisible();
}

async function addRecipeMeal(page: Page, date: string, title: string, recipeUrl: string, ingredients: string) {
  await page.goto(`/meals?date=${date}&plan=1`);
  await page.getByText('Add meal from recipe link', { exact: true }).click();
  const link = page.getByRole('form', { name: 'Add meal from recipe link' });
  await link.getByLabel('Recipe link').fill(recipeUrl);
  await link.getByRole('button', { name: 'Review draft' }).click();
  await page.getByRole('button', { name: 'Preview recipe details' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Recipe details loaded from eMeals' })).toBeVisible();
  const draft = page.getByRole('form', { name: 'Save recipe meal' });
  await draft.getByLabel('Meal name').fill(title);
  await draft.getByLabel('Ingredients').fill(ingredients);
  await draft.getByRole('button', { name: 'Save meal' }).click();
  await expect(day(page, date).getByRole('article').filter({ hasText: title })).toBeVisible();
}

test('a parent shops a planned week, reviews duplicates and provider ingredients, and keeps the meals', async ({ page }, testInfo) => {
  const household = await shoppingHousehold();
  const stamp = Date.now();
  const pasta = `Shop pasta ${stamp}`;
  const bowls = `Shop bowls ${stamp}`;
  const provider = `Shop provider ${stamp}`;
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, household.members['Sample Parent']);
  await page.goto('/groceries');
  const initialAdd = page.getByRole('form', { name: 'Add grocery item' });
  await initialAdd.getByLabel('Item', { exact: true }).fill('shop onion');
  await initialAdd.getByLabel('Quantity').fill('3');
  await initialAdd.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByRole('article').filter({ hasText: 'shop onion' })).toContainText('3');

  await addMeal(page, '2100-02-08', pasta, '2 cups shop rice\n1 shop onion\n1 shop bell pepper');
  await addMeal(page, '2100-02-09', bowls, '1 cup shop rice\n2 shop carrots');
  await addRecipeMeal(page, '2100-02-10', provider, 'https://emeals.com/recipes/synthetic-preview', '1 family cucumber');

  await page.goto('/meals?week=2100-02-07');
  await page.getByRole('link', { name: 'Shop the week', exact: true }).click();
  await settle(page);
  await expect(page.getByRole('heading', { name: 'Shop the week' })).toBeVisible();
  await expect(page.getByText(/Feb 7.*13, 2100/)).toBeVisible();
  const selection = page.getByRole('form', { name: 'Select ingredients for the week' });
  const pastaSection = page.getByRole('region', { name: 'Ingredients for 2100-02-08' });
  const bowlsSection = page.getByRole('region', { name: 'Ingredients for 2100-02-09' });
  const providerSection = page.getByRole('region', { name: 'Ingredients for 2100-02-10' });
  await pastaSection.getByRole('article').filter({ hasText: pasta }).getByLabel('2 cups shop rice').check();
  await pastaSection.getByRole('article').filter({ hasText: pasta }).getByLabel('1 shop onion').check();
  await pastaSection.getByRole('article').filter({ hasText: pasta }).getByLabel('1 shop bell pepper').check();
  await bowlsSection.getByRole('article').filter({ hasText: bowls }).getByLabel('1 cup shop rice').check();
  await bowlsSection.getByRole('article').filter({ hasText: bowls }).getByLabel('2 shop carrots').check();
  await expect(providerSection).toContainText('Recipe ingredients from eMeals · Synthetic Side Salad');
  await providerSection.getByRole('article').filter({ hasText: provider }).getByLabel('1 synthetic lemon').check();
  await page.screenshot({ path: testInfo.outputPath('shop-week-selection-mobile.png'), fullPage: true });
  await selection.getByRole('button', { name: 'Review selected ingredients' }).click();

  const review = page.getByRole('region', { name: 'Review week ingredients for groceries' });
  await expect(review).toBeVisible();
  const riceA = review.getByRole('group', { name: '2 cups shop rice' });
  const riceB = review.getByRole('group', { name: '1 cup shop rice' });
  await expect(riceA).toContainText('Needed for:');
  await expect(riceA).toContainText(pasta);
  await expect(riceA).toContainText(bowls);
  await expect(riceB).toContainText('skipped by default');
  await expect(riceB.getByLabel('Skip this item')).toBeChecked();
  await riceB.getByLabel('Add this item').check();
  const onion = review.getByRole('group', { name: '1 shop onion' });
  await expect(onion).toContainText('Already on your list: shop onion (3)');
  await expect(onion.getByLabel('Skip this item')).toBeChecked();
  const lemon = review.getByRole('group', { name: '1 synthetic lemon' });
  await expect(lemon).toContainText('Recipe ingredients from eMeals');
  await expect(lemon).toContainText('Synthetic Side Salad');
  await page.screenshot({ path: testInfo.outputPath('shop-week-review-mobile.png'), fullPage: true });
  await review.getByRole('button', { name: 'Add reviewed ingredients' }).click();

  await expect(page.getByRole('status').filter({ hasText: /^Added 5 items and skipped 1\.$/ })).toBeVisible();
  const riceItems = page.getByRole('article').filter({ hasText: 'shop rice' });
  await expect(riceItems).toHaveCount(2);
  await expect(riceItems.filter({ hasText: '2 cups' })).toHaveCount(1);
  await expect(riceItems.filter({ hasText: '1 cup' })).toHaveCount(1);
  await expect(page.getByRole('article').filter({ hasText: 'shop onion' })).toHaveCount(1);
  await expect(page.getByRole('article').filter({ hasText: 'shop bell pepper' })).toContainText('1');
  await expect(page.getByRole('article').filter({ hasText: 'shop carrots' })).toContainText('2');
  await expect(page.getByRole('article').filter({ hasText: 'synthetic lemon' })).toContainText('1');

  await page.goto('/meals?date=2100-02-08');
  await expect(day(page, '2100-02-08').getByRole('article').filter({ hasText: pasta })).toContainText('2 cups shop rice');
  await expect(day(page, '2100-02-09').getByRole('article').filter({ hasText: bowls })).toContainText('1 cup shop rice');
});

test('a second parent changing the list forces an explicit duplicate decision', async ({ page, browser }, testInfo) => {
  const household = await shoppingHousehold();
  const stamp = Date.now();
  const title = `Conflict dinner ${stamp}`;
  await signIn(page, household.members['Sample Parent']);
  await addMeal(page, '2100-02-15', title, '2 cups conflict flour');
  await page.goto('/meals/shop?week=2100-02-14');
  const selection = page.getByRole('form', { name: 'Select ingredients for the week' });
  await selection.getByLabel('2 cups conflict flour').check();
  await selection.getByRole('button', { name: 'Review selected ingredients' }).click();
  const review = page.getByRole('region', { name: 'Review week ingredients for groceries' });
  await expect(review.getByRole('group', { name: '2 cups conflict flour' }).getByLabel('Add this item')).toBeChecked();

  const secondContext = await browser.newContext();
  try {
    const second = await secondContext.newPage();
    await signIn(second, household.members['Multi Parent']);
    await second.goto('/groceries');
    const add = second.getByRole('form', { name: 'Add grocery item' });
    await add.getByLabel('Item', { exact: true }).fill('conflict flour');
    await add.getByLabel('Quantity').fill('1');
    await add.getByRole('button', { name: 'Add item' }).click();
    await expect(second.getByRole('article').filter({ hasText: 'conflict flour' })).toContainText('1');
  } finally { await secondContext.close(); }

  await review.getByRole('button', { name: 'Add reviewed ingredients' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'grocery list changed' })).toBeVisible();
  const retryReview = page.getByRole('region', { name: 'Review week ingredients for groceries' });
  const flour = retryReview.getByRole('group', { name: '2 cups conflict flour' });
  await expect(flour).toContainText('Already on your list: conflict flour (1)');
  await flour.getByLabel('Keep separate duplicate').check();
  await page.screenshot({ path: testInfo.outputPath('shop-week-conflict-mobile.png'), fullPage: true });
  await retryReview.getByRole('button', { name: 'Add reviewed ingredients' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Added 1 item and skipped 0\.$/ })).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'conflict flour' })).toHaveCount(2);
  await page.goto('/meals?date=2100-02-15');
  await expect(day(page, '2100-02-15').getByRole('article').filter({ hasText: title })).toContainText('2 cups conflict flour');
});

test('shop the week works without JavaScript and rejects children and cross-origin requests', async ({ page, browser }) => {
  const household = await shoppingHousehold();
  const stamp = Date.now();
  const title = `Native shop dinner ${stamp}`;
  expect((await page.request.get('/meals/shop', { maxRedirects: 0 })).status()).toBe(303);
  await signIn(page, household.members['Sample Parent']);
  await addMeal(page, '2100-02-22', title, '3 hydration pears');

  const kidContext = await browser.newContext();
  try {
    const kid = await kidContext.newPage();
    await signIn(kid, household.members['Sample Kid']);
    expect((await kid.request.get('/meals/shop', { maxRedirects: 0 })).status()).toBe(403);
    const denied = await kid.request.post('/meals/shop?/review', { form: { week: '2100-02-21' }, headers: { origin: 'http://127.0.0.1:4173' } });
    expect(denied.status()).toBe(403);
  } finally { await kidContext.close(); }
  const crossOrigin = await page.request.post('/meals/shop?/review', { form: { week: '2100-02-21' }, headers: { origin: 'https://other.example.test' } });
  expect(crossOrigin.status()).toBe(403);

  const nativeContext = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    const native = await nativeContext.newPage();
    await native.goto('/meals/shop?week=2100-02-21');
    await native.getByLabel('3 hydration pears').check();
    await native.getByRole('button', { name: 'Review selected ingredients' }).click();
    const review = native.getByRole('region', { name: 'Review week ingredients for groceries' });
    await expect(review).toBeVisible();
    await review.getByRole('button', { name: 'Add reviewed ingredients' }).click();
    await expect(native.getByRole('status').filter({ hasText: /^Added 1 item and skipped 0\.$/ })).toBeVisible();
    await expect(native.getByRole('article').filter({ hasText: 'hydration pears' })).toContainText('3');
  } finally { await nativeContext.close(); }

  const delayedContext = await browser.newContext({ storageState: await page.context().storageState() });
  let release!: () => void, requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const blocked = new Promise<void>(resolve => { requested = resolve; });
  try {
    const delayed = await delayedContext.newPage();
    await delayed.route(pageModule('meals/shop'), async route => { requested(); await gate; await route.continue(); });
    await delayed.goto('/meals/shop?week=2100-02-21', { waitUntil: 'commit' });
    await blocked;
    const checkbox = delayed.getByLabel('3 hydration pears');
    await checkbox.check();
    release();
    await hydrated(delayed);
    await expect(delayed.getByLabel('3 hydration pears')).toBeChecked();
    expect(await delayed.getByRole('form', { name: 'Select ingredients for the week' }).evaluate(element => new FormData(element as HTMLFormElement).getAll('ingredient'))).toHaveLength(1);
  } finally { release(); await delayedContext.close(); }
});

test('week review edits survive delayed hydration and are submitted', async ({ page, browser }) => {
  const household = await shoppingHousehold();
  const stamp = Date.now();
  const title = `Hydration review dinner ${stamp}`;
  const ingredient = `2 cups hydration review beans ${stamp}`;
  await signIn(page, household.members['Sample Parent']);
  await addMeal(page, '2100-02-28', title, ingredient);

  const context = await browser.newContext({ storageState: await page.context().storageState() });
  let release!: () => void, firstRequest!: () => void, secondRequest!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = new Promise<void>(resolve => { firstRequest = resolve; });
  const second = new Promise<void>(resolve => { secondRequest = resolve; });
  let requests = 0;
  try {
    const delayed = await context.newPage();
    await delayed.route(pageModule('meals/shop'), async route => {
      requests += 1;
      if (requests === 1) firstRequest();
      if (requests === 2) secondRequest();
      await gate;
      await route.continue();
    });
    await delayed.goto('/meals/shop?week=2100-02-28', { waitUntil: 'commit' });
    await first;
    await delayed.getByLabel(ingredient).check();
    await delayed.getByRole('button', { name: 'Review selected ingredients' }).click();
    await second;
    const review = delayed.getByRole('region', { name: 'Review week ingredients for groceries' });
    const line = review.getByRole('group', { name: ingredient });
    await line.getByLabel('Item name').fill('hydration review beans');
    await line.getByLabel('Quantity').fill('5');
    await line.getByLabel('Unit').fill('cans');
    release();
    await hydrated(delayed);
    expect(await review.evaluate(element => Object.fromEntries(new FormData(element.querySelector('form') as HTMLFormElement)))).toMatchObject({ 'name-0': 'hydration review beans', 'quantity-0': '5', 'unit-0': 'cans', 'action-0': 'add' });
    await review.getByRole('button', { name: 'Add reviewed ingredients' }).click();
    await expect(delayed.getByRole('article').filter({ hasText: 'hydration review beans' })).toContainText('5 cans');
  } finally { release(); await context.close(); }
});
