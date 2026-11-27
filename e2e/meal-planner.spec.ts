import { expect, test, type Page } from '@playwright/test';
import { settle } from './support/navigation';

async function signIn(page: Page, email = 'parent@example.test', password = 'synthetic-parent-password') {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

function day(page: Page, date: string) {
  return page.getByRole('region', { name: `Meals for ${date}`, exact: true });
}

test('a parent plans, adds, moves and removes meals across a seven-day week', async ({ page }, testInfo) => {
  const stamp = Date.now();
  const first = `Planner first dinner ${stamp}`;
  const second = `Planner second dinner ${stamp}`;
  const weekDate = '2099-10-04';
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await page.goto(`/meals?date=${weekDate}`);

  await expect(page.getByRole('heading', { name: `Meals for ${weekDate}` })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Planned meals' })).toBeVisible();
  await expect(day(page, weekDate).getByText('No meals planned for this day yet.')).toBeVisible();

  await page.getByRole('link', { name: `Plan a meal for ${weekDate}`, exact: true }).click();
  await settle(page);
  const add = page.getByRole('form', { name: 'Add meal', exact: true });
  await expect(add.getByLabel('Date', { exact: true })).toHaveValue(weekDate);
  await add.getByLabel('Meal name').fill(first);
  await add.getByLabel('Ingredients').fill('2 cups planner beans\n1 planner onion');
  await add.getByLabel('Private notes (optional)').fill(`Planner note ${stamp}`);
  await add.getByLabel('Share on family display').check();
  await add.getByRole('button', { name: 'Save meal' }).click();
  await expect(day(page, weekDate).getByRole('article').filter({ hasText: first })).toBeVisible();

  await day(page, weekDate).getByRole('link', { name: `Add another meal for ${weekDate}`, exact: true }).click();
  await settle(page);
  const addAnother = page.getByRole('form', { name: 'Add meal', exact: true });
  await expect(addAnother.getByLabel('Date', { exact: true })).toHaveValue(weekDate);
  await addAnother.getByLabel('Meal name').fill(second);
  await addAnother.getByLabel('Ingredients').fill('1 planner squash');
  await addAnother.getByLabel('Share on family display').check();
  await addAnother.getByRole('button', { name: 'Save meal' }).click();
  await expect(day(page, weekDate).getByRole('article').filter({ hasText: first })).toBeVisible();
  await expect(day(page, weekDate).getByRole('article').filter({ hasText: second })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('meal-week-mobile.png'), fullPage: true });

  const secondArticle = day(page, weekDate).getByRole('article').filter({ hasText: second });
  await secondArticle.locator('summary').filter({ hasText: /^Move meal$/ }).click();
  const move = secondArticle.getByRole('form', { name: `Move ${second}` });
  await move.getByLabel('New date').fill('2099-10-06');
  await move.getByRole('button', { name: 'Move meal' }).click();
  await expect(page.getByRole('heading', { name: 'Meals for 2099-10-06' })).toBeVisible();
  const movedArticle = day(page, '2099-10-06').getByRole('article').filter({ hasText: second });
  await expect(movedArticle).toBeVisible();
  await expect(day(page, weekDate).getByRole('article').filter({ hasText: second })).toHaveCount(0);
  await movedArticle.getByText('Edit meal', { exact: true }).click();
  const movedEdit = movedArticle.getByRole('form', { name: `Edit ${second}` });
  await expect(movedEdit.getByLabel('Ingredients')).toHaveValue('1 planner squash');
  await expect(movedEdit.getByLabel('Share on family display')).toBeChecked();

  const firstArticle = day(page, weekDate).getByRole('article').filter({ hasText: first });
  await firstArticle.getByText('Remove meal…', { exact: true }).click();
  await expect(firstArticle).toContainText('There is no undo.');
  await firstArticle.getByRole('button', { name: 'Remove this meal' }).click();
  await expect(firstArticle).toHaveCount(0);
  await expect(day(page, weekDate).getByText('No meals planned for this day yet.')).toBeVisible();

  await page.getByRole('link', { name: 'Next week', exact: true }).click();
  await settle(page);
  await expect(page.getByRole('heading', { name: 'Meals for 2099-10-11' })).toBeVisible();
  await page.getByRole('link', { name: 'Previous week', exact: true }).click();
  await settle(page);
  await expect(page.getByRole('heading', { name: `Meals for ${weekDate}` })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: testInfo.outputPath('meal-week-desktop.png'), fullPage: true });
});

for (const javaScriptEnabled of [true, false]) {
  test(`weekly planning recovery, move confirmation and removal work with JavaScript ${javaScriptEnabled ? 'on' : 'off'}`, async ({ page, browser }, testInfo) => {
    const stamp = Date.now();
    const title = `Planner recovery dinner ${stamp} ${javaScriptEnabled}`;
    const weekDate = '2099-09-06';
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
    const context = await browser.newContext({ javaScriptEnabled, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
    try {
      const planner = await context.newPage();
      await planner.goto(`/meals?date=${weekDate}&plan=1`);
      await expect(planner.getByRole('heading', { name: `Meals for ${weekDate}` })).toBeVisible();
      let form = planner.getByRole('form', { name: 'Add meal', exact: true });
      await expect(form.getByLabel('Date', { exact: true })).toHaveValue(weekDate);
      await form.getByLabel('Meal name').fill('   ');
      await form.getByLabel('Ingredients').fill('3 recovery carrots');
      await form.getByRole('button', { name: 'Save meal' }).click();
      await expect(planner.getByRole('status').filter({ hasText: 'Unable to save meal' })).toBeVisible();
      await expect(planner.getByRole('heading', { name: `Meals for ${weekDate}` })).toBeVisible();
      form = planner.getByRole('form', { name: 'Add meal', exact: true });
      await expect(form.getByLabel('Date', { exact: true })).toHaveValue(weekDate);
      await expect(form.getByLabel('Ingredients')).toHaveValue('3 recovery carrots');
      await form.getByLabel('Meal name').fill(title);
      await form.getByRole('button', { name: 'Save meal' }).click();
      const article = day(planner, weekDate).getByRole('article').filter({ hasText: title });
      await expect(article).toBeVisible();
      await article.getByText('Remove meal…', { exact: true }).click();
      await article.getByRole('button', { name: 'Remove this meal' }).click();
      await expect(article).toHaveCount(0);
      await planner.screenshot({ path: testInfo.outputPath(`meal-week-recovery-javascript-${javaScriptEnabled}.png`), fullPage: true });
    } finally { await context.close(); }
  });
}

test('a child sees only shared meals in the weekly view and anonymous requests are rejected', async ({ page, browser }) => {
  const stamp = Date.now();
  const shared = `Planner shared dinner ${stamp}`;
  const privateMeal = `Planner private dinner ${stamp}`;
  const privateNote = `Planner private note ${stamp}`;
  const weekDate = '2099-11-01';
  const anonymous = await page.request.get(`/meals?date=${weekDate}`, { maxRedirects: 0 });
  expect(anonymous.status()).toBe(303);
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();

  await page.goto(`/meals?date=${weekDate}&plan=1`);
  const add = page.getByRole('form', { name: 'Add meal', exact: true });
  await add.getByLabel('Meal name').fill(privateMeal);
  await add.getByLabel('Private notes (optional)').fill(privateNote);
  await add.getByRole('button', { name: 'Save meal' }).click();
  await expect(day(page, weekDate).getByRole('article').filter({ hasText: privateMeal })).toBeVisible();

  await page.getByRole('link', { name: `Add another meal for ${weekDate}`, exact: true }).click();
  await settle(page);
  const sharedForm = page.getByRole('form', { name: 'Add meal', exact: true });
  await sharedForm.getByLabel('Meal name').fill(shared);
  await sharedForm.getByLabel('Ingredients').fill('1 shared planner apple');
  await sharedForm.getByLabel('Share on family display').check();
  await sharedForm.getByRole('button', { name: 'Save meal' }).click();
  await expect(day(page, weekDate).getByRole('article').filter({ hasText: shared })).toBeVisible();

  const childContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  try {
    const child = await childContext.newPage();
    await signIn(child, 'kid@example.test', 'synthetic-kid-password');
    await expect(child.getByRole('heading', { name: "Sample Kid's My Day" })).toBeVisible();
    await child.goto(`/meals?date=${weekDate}`);
    await expect(child.getByRole('heading', { name: `Meals for ${weekDate}` })).toBeVisible();
    await expect(day(child, weekDate).getByRole('article').filter({ hasText: shared })).toBeVisible();
    await expect(child.getByText(privateMeal)).toHaveCount(0);
    await expect(child.getByText(privateNote)).toHaveCount(0);
    await expect(child.getByRole('link', { name: `Plan a meal for ${weekDate}`, exact: true })).toHaveCount(0);
    await expect(child.getByText('Add a meal', { exact: true })).toHaveCount(0);
    await expect(child.getByText('Edit meal', { exact: true })).toHaveCount(0);
    await expect(child.getByText('Remove meal…', { exact: true })).toHaveCount(0);
  } finally { await childContext.close(); }
});
