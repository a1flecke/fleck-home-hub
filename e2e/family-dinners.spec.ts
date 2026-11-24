import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, email = 'parent@example.test', password = 'synthetic-parent-password', heading = 'Hello, Sample Parent') {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

function shift(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function nextSunday(date: string): string {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return shift(date, weekday === 0 ? 7 : 7 - weekday);
}

function day(page: Page, date: string) {
  return page.getByRole('region', { name: `Meals for ${date}`, exact: true });
}

async function waitForHydration(page: Page) {
  // Let module loading settle before editing bound textareas so Svelte hydration
  // cannot reset the field between Playwright's select and insert steps.
  await page.waitForLoadState('networkidle');
}

async function addMeal(page: Page, date: string, title: string, ingredients: string, options: { recipeUrl?: string; note?: string; shared?: boolean } = {}) {
  await page.goto(`/meals?date=${date}&plan=1`);
  await waitForHydration(page);
  const form = page.getByRole('form', { name: 'Add meal', exact: true });
  await form.getByLabel('Meal name').fill(title);
  await form.getByLabel('Ingredients').fill(ingredients);
  if (options.recipeUrl) await form.getByLabel('Recipe link (optional)').fill(options.recipeUrl);
  if (options.note) await form.getByLabel('Private notes (optional)').fill(options.note);
  if (options.shared) await form.getByLabel('Share on family display').check();
  await form.getByRole('button', { name: 'Save meal' }).click();
  await expect(day(page, date).getByRole('article').filter({ hasText: title })).toBeVisible();
}

test('a parent sees the next seven dinners, today’s details and direct plan links', async ({ page }, testInfo) => {
  const stamp = Date.now();
  const todayTitle = `Dashboard today dinner ${stamp}`;
  const tomorrowTitle = `Dashboard tomorrow dinner ${stamp}`;
  const note = `Dashboard private note ${stamp}`;
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  const display = await page.request.get('/display/data');
  expect(display.status()).toBe(200);
  const today = (await display.json()).today as string;
  const tomorrow = shift(today, 1);
  const empty = shift(today, 2);
  await addMeal(page, today, todayTitle, '2 cups dashboard rice', { recipeUrl: 'https://example.test/dashboard-recipe', note, shared: true });
  await addMeal(page, tomorrow, tomorrowTitle, '1 dashboard pear');

  await page.goto('/dashboard');
  const tonight = page.getByRole('region', { name: "Tonight's meal" });
  const dinner = tonight.getByRole('article').filter({ hasText: todayTitle });
  await expect(dinner).toContainText('2 cups dashboard rice');
  await expect(dinner.getByRole('link', { name: 'View recipe' })).toHaveAttribute('href', 'https://example.test/dashboard-recipe');
  await expect(tonight.getByRole('link', { name: 'Open today in the planner' })).toHaveAttribute('href', `/meals?date=${today}`);
  await expect(tonight.getByRole('link', { name: 'Shop this week' })).toBeVisible();

  const week = page.getByRole('region', { name: 'Next seven dinners' });
  await expect(week).toContainText(todayTitle);
  await expect(week).toContainText(tomorrowTitle);
  await expect(week).toContainText(/night.*need.*a plan\./);
  await page.screenshot({ path: testInfo.outputPath('dashboard-dinners-mobile.png'), fullPage: true });
  await week.getByRole('link', { name: `Plan dinner for ${empty}` }).click();
  await expect(page.getByRole('heading', { name: `Meals for ${empty}` })).toBeVisible();
  const add = page.getByRole('form', { name: 'Add meal', exact: true });
  await expect(add).toBeVisible();
  await expect(add.getByLabel('Date', { exact: true })).toHaveValue(empty);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/dashboard');
  await page.screenshot({ path: testInfo.outputPath('dashboard-dinners-desktop.png'), fullPage: true });
});

test('a child sees only shared dinners in a read-only week', async ({ page, browser }, testInfo) => {
  const stamp = Date.now();
  const sharedTitle = `Shared child dinner ${stamp}`;
  const privateTitle = `Private child dinner ${stamp}`;
  const note = `Child private note ${stamp}`;
  await signIn(page);
  const display = await page.request.get('/display/data');
  const today = (await display.json()).today as string;
  await addMeal(page, today, sharedTitle, '1 shared child apple', { shared: true });
  await addMeal(page, today, privateTitle, '1 private child pear', { note });

  const childContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  try {
    const child = await childContext.newPage();
    await signIn(child, 'kid@example.test', 'synthetic-kid-password', "Sample Kid's My Day");
    const family = child.getByRole('region', { name: 'Family dinners' });
    await expect(family).toContainText(sharedTitle);
    await expect(family).not.toContainText(privateTitle);
    expect(await child.content()).not.toContain(note);
    await expect(family.getByRole('link', { name: `Plan dinner for ${today}` })).toHaveCount(0);
    await expect(child.getByRole('link', { name: 'Shop this week' })).toHaveCount(0);
    await child.screenshot({ path: testInfo.outputPath('kid-family-dinners-mobile.png'), fullPage: true });
    await family.getByRole('link', { name: 'See the full week' }).click();
    await expect(child.getByRole('heading', { name: `Meals for ${today}` })).toBeVisible();
    await expect(day(child, today).getByRole('article').filter({ hasText: sharedTitle })).toBeVisible();
    await expect(child.getByText(privateTitle)).toHaveCount(0);
  } finally { await childContext.close(); }
});

test('anonymous users are redirected and a parent completes plan, repeat, shop and bought flow', async ({ page }) => {
  const stamp = Date.now();
  const firstTitle = `Journey first dinner ${stamp}`;
  const secondTitle = `Journey second dinner ${stamp}`;
  const copyTitle = `Journey copy dinner ${stamp}`;
  const anonymous = await page.request.get('/dashboard', { maxRedirects: 0 });
  expect(anonymous.status()).toBe(303);
  await signIn(page);
  const display = await page.request.get('/display/data');
  const today = (await display.json()).today as string;
  const start = nextSunday(today);
  const second = shift(start, 1);
  const copyDate = shift(start, 2);

  await addMeal(page, start, firstTitle, '2 cups journey rice\n1 journey onion');
  await addMeal(page, second, secondTitle, '1 cup journey rice');

  await page.goto(`/meals/again?q=${encodeURIComponent(firstTitle)}`);
  await page.getByRole('link', { name: `Plan again: ${firstTitle}` }).click();
  const adjust = page.getByRole('form', { name: 'Preview a meal plan' });
  await expect(adjust).toBeVisible();
  await waitForHydration(page);
  await adjust.getByLabel('Meal name').fill(copyTitle);
  await adjust.getByLabel('New date').fill(copyDate);
  await adjust.getByLabel('Ingredients').fill('3 journey carrots');
  await adjust.getByRole('button', { name: 'Preview plan' }).click();
  await page.getByRole('button', { name: 'Save this plan' }).click();
  await expect(page.getByRole('heading', { name: `Meals for ${copyDate}` })).toBeVisible();
  await expect(day(page, copyDate).getByRole('article').filter({ hasText: copyTitle })).toBeVisible();

  await page.goto(`/meals/shop?week=${start}`);
  const selection = page.getByRole('form', { name: 'Select ingredients for the week' });
  await selection.getByLabel('2 cups journey rice').check();
  await selection.getByLabel('1 journey onion').check();
  await selection.getByLabel('1 cup journey rice').check();
  await selection.getByLabel('3 journey carrots').check();
  await selection.getByRole('button', { name: 'Review selected ingredients' }).click();
  const review = page.getByRole('region', { name: 'Review week ingredients for groceries' });
  await expect(review.getByRole('group', { name: '1 cup journey rice' }).getByLabel('Skip this item')).toBeChecked();
  await review.getByRole('button', { name: 'Add reviewed ingredients' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Added 3 items and skipped 1\.$/ })).toBeVisible();

  const onion = page.getByRole('article').filter({ hasText: 'journey onion' });
  await expect(onion).toContainText('To buy');
  await onion.getByRole('button', { name: 'Mark bought' }).click();
  await page.locator('summary').filter({ hasText: /^Bought/ }).click();
  await expect(page.getByRole('article').filter({ hasText: 'journey onion' })).toContainText('Bought');
  await expect(page.getByRole('article').filter({ hasText: 'journey rice' })).toContainText('2 cups');
  await expect(page.getByRole('article').filter({ hasText: 'journey carrots' })).toContainText('3');
});
