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

async function addMeal(page: Page, date: string, title: string, ingredients: string, options: { recipeUrl?: string; notes?: string; shared?: boolean } = {}) {
  await page.goto(`/meals?date=${date}&plan=1`);
  const form = page.getByRole('form', { name: 'Add meal', exact: true });
  await form.getByLabel('Meal name').fill(title);
  await form.getByLabel('Ingredients').fill(ingredients);
  if (options.recipeUrl) await form.getByLabel('Recipe link (optional)').fill(options.recipeUrl);
  if (options.notes) await form.getByLabel('Private notes (optional)').fill(options.notes);
  if (options.shared) await form.getByLabel('Share on family display').check();
  await form.getByRole('button', { name: 'Save meal' }).click();
  await expect(day(page, date).getByRole('article').filter({ hasText: title })).toBeVisible();
}

test('a parent repeats a favorite dinner into a private, separately editable meal', async ({ page, browser }, testInfo) => {
  const stamp = Date.now();
  const sourceTitle = `Plan again source ${stamp}`;
  const copyTitle = `Plan again copy ${stamp}`;
  const note = `Original private note ${stamp}`;
  const recipeUrl = 'https://emeals.com/recipes/synthetic-plan-again';
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await addMeal(page, '2099-12-06', sourceTitle, '2 cups original beans\n1 original onion', { recipeUrl, notes: note, shared: true });

  await page.getByRole('link', { name: 'Plan it again from a recent meal', exact: true }).click();
  await settle(page);
  await expect(page.getByRole('heading', { name: 'Plan it again' })).toBeVisible();
  await page.getByLabel('Search past dinners').fill(sourceTitle);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await settle(page);
  const sourceCard = page.getByRole('article').filter({ hasText: sourceTitle });
  await expect(sourceCard).toBeVisible();
  await expect(sourceCard).toContainText('Recipe source: eMeals');
  await sourceCard.getByRole('link', { name: `Plan again: ${sourceTitle}` }).click();
  await settle(sourceCard);

  const adjust = page.getByRole('form', { name: 'Preview a meal plan' });
  await expect(adjust.getByLabel('Meal name')).toHaveValue(sourceTitle);
  await expect(adjust.getByLabel('Ingredients')).toHaveValue('2 cups original beans\n1 original onion');
  await expect(adjust.getByLabel('Recipe link (optional)')).toHaveValue(recipeUrl);
  await adjust.getByLabel('Meal name').fill(copyTitle);
  await adjust.getByLabel('New date').fill('2099-12-08');
  await adjust.getByLabel('Serving time (optional)').fill('19:15');
  await adjust.getByLabel('Servings (optional)').fill('6');
  await adjust.getByLabel('Ingredients').fill('3 copied carrots\n1 copied lemon');
  await adjust.getByRole('button', { name: 'Preview plan' }).click();

  const preview = page.getByRole('region', { name: 'Plan preview', exact: true });
  await expect(preview).toContainText(copyTitle);
  await expect(preview).toContainText('2099-12-08');
  await expect(preview).toContainText('19:15');
  await expect(preview).toContainText('6');
  await expect(preview).toContainText('3 copied carrots');
  await expect(preview).toContainText('Recipe source: eMeals');
  await expect(preview.getByRole('link', { name: 'Open original recipe on eMeals' })).toHaveAttribute('href', recipeUrl);
  await expect(preview).not.toContainText(note);
  await page.screenshot({ path: testInfo.outputPath('plan-again-preview-mobile.png'), fullPage: true });
  await preview.getByRole('button', { name: 'Save this plan' }).click();

  await expect(page.getByRole('heading', { name: 'Meals for 2099-12-08' })).toBeVisible();
  const copyArticle = day(page, '2099-12-08').getByRole('article').filter({ hasText: copyTitle });
  await expect(copyArticle).toContainText('3 copied carrots');
  await expect(copyArticle).toContainText('Recipe source: eMeals');
  await expect(copyArticle).not.toContainText(note);
  const originalArticle = day(page, '2099-12-06').getByRole('article').filter({ hasText: sourceTitle });
  await expect(originalArticle).toContainText('2 cups original beans');
  await expect(originalArticle).toContainText(note);

  await copyArticle.getByText('Edit meal', { exact: true }).click();
  const copyEdit = copyArticle.getByRole('form', { name: `Edit ${copyTitle}` });
  await expect(copyEdit.getByLabel('Private notes (optional)')).toHaveValue('');
  await expect(copyEdit.getByLabel('Share on family display')).not.toBeChecked();

  const childContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  try {
    const child = await childContext.newPage();
    await signIn(child, 'kid@example.test', 'synthetic-kid-password');
    await expect(child.getByRole('heading', { name: "Sample Kid's My Day" })).toBeVisible();
    await child.goto('/meals?date=2099-12-08');
    await expect(day(child, '2099-12-08').getByRole('article').filter({ hasText: copyTitle })).toHaveCount(0);
    await child.goto('/meals?date=2099-12-06');
    await expect(day(child, '2099-12-06').getByRole('article').filter({ hasText: sourceTitle })).toBeVisible();
    expect(await child.content()).not.toContain(note);
  } finally { await childContext.close(); }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/meals/again?q=${encodeURIComponent(sourceTitle)}`);
  await page.screenshot({ path: testInfo.outputPath('plan-again-list-desktop.png'), fullPage: true });
});

test('a previewed copy is idempotent on retry and a removed source is handled gracefully', async ({ page }, testInfo) => {
  const stamp = Date.now();
  const sourceTitle = `Retry source ${stamp}`;
  const copyTitle = `Retry copy ${stamp}`;
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await addMeal(page, '2099-12-20', sourceTitle, '1 retry squash');
  await page.goto(`/meals/again?q=${encodeURIComponent(sourceTitle)}`);
  const sourceCard = page.getByRole('article').filter({ hasText: sourceTitle });
  const link = sourceCard.getByRole('link', { name: `Plan again: ${sourceTitle}` });
  const href = await link.getAttribute('href');
  const sourceId = new URL(href!, 'http://127.0.0.1:4173').searchParams.get('source');
  expect(sourceId).toBeTruthy();
  await link.click();
  const adjust = page.getByRole('form', { name: 'Preview a meal plan' });
  await adjust.getByLabel('Meal name').fill(copyTitle);
  await adjust.getByLabel('New date').fill('2099-12-21');
  await adjust.getByRole('button', { name: 'Preview plan' }).click();
  const saveForm = page.getByRole('form', { name: 'Save this plan' });
  const submissionKey = await saveForm.locator('input[name="submissionKey"]').inputValue();
  const fields = {
    sourceId: sourceId!,
    title: copyTitle,
    date: '2099-12-21',
    time: '',
    servings: '',
    ingredients: '1 retry squash',
    source: '',
    recipeUrl: '',
    recipeDetails: '',
    submissionKey
  };
  const origin = 'http://127.0.0.1:4173';
  await page.request.post('/meals/again?/save', { form: fields, headers: { origin } });
  await page.request.post('/meals/again?/save', { form: fields, headers: { origin } });
  await page.goto('/meals?date=2099-12-21');
  await expect(day(page, '2099-12-21').getByRole('article').filter({ hasText: copyTitle })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('plan-again-saved-mobile.png'), fullPage: true });

  await page.goto('/meals?date=2099-12-20');
  const sourceArticle = day(page, '2099-12-20').getByRole('article').filter({ hasText: sourceTitle });
  await sourceArticle.getByText('Remove meal…', { exact: true }).click();
  await sourceArticle.getByRole('button', { name: 'Remove this meal' }).click();
  await expect(sourceArticle).toHaveCount(0);
  await page.goto(`/meals/again?source=${sourceId}`);
  await expect(page.getByText('That meal is no longer available', { exact: false })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Preview a meal plan' })).toHaveCount(0);
});

test('planning again works without JavaScript and rejects children and cross-origin requests', async ({ page, browser }) => {
  const stamp = Date.now();
  const sourceTitle = `Native again source ${stamp}`;
  const copyTitle = `Native again copy ${stamp}`;
  const anonymous = await page.request.get('/meals/again', { maxRedirects: 0 });
  expect(anonymous.status()).toBe(303);
  const sourceId = await (async () => {
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
    await addMeal(page, '2099-12-27', sourceTitle, '2 native pears');
    await page.goto(`/meals/again?q=${encodeURIComponent(sourceTitle)}`);
    const link = page.getByRole('article').filter({ hasText: sourceTitle }).getByRole('link', { name: `Plan again: ${sourceTitle}` });
    const href = await link.getAttribute('href');
    return new URL(href!, 'http://127.0.0.1:4173').searchParams.get('source')!;
  })();
  const kidContext = await browser.newContext();
  try {
    const kid = await kidContext.newPage();
    await signIn(kid, 'kid@example.test', 'synthetic-kid-password');
    await expect(kid.getByRole('heading', { name: "Sample Kid's My Day" })).toBeVisible();
    const denied = await kid.request.get('/meals/again', { maxRedirects: 0 });
    expect(denied.status()).toBe(403);
    const deniedSave = await kid.request.post('/meals/again?/save', { form: { sourceId, title: 'Forbidden copy', date: '2099-12-28' }, headers: { origin: 'http://127.0.0.1:4173' } });
    expect(deniedSave.status()).toBe(403);
  } finally { await kidContext.close(); }

  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await signIn(other, 'other-parent@example.test', 'synthetic-other-parent-password');
    await expect(other.getByRole('heading', { name: 'Hello, Other Parent' })).toBeVisible();
    await other.goto(`/meals/again?source=${sourceId}`);
    await expect(other.getByText('That meal is no longer available', { exact: false })).toBeVisible();
    expect(await other.content()).not.toContain(sourceTitle);
  } finally { await otherContext.close(); }

  const crossOrigin = await page.request.post('/meals/again?/preview', { form: { sourceId, title: 'Forbidden copy', date: '2099-12-28' }, headers: { origin: 'https://other.example.test' } });
  expect(crossOrigin.status()).toBe(403);

  const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    const native = await context.newPage();
    await native.goto(`/meals/again?q=${encodeURIComponent(sourceTitle)}`);
    await native.getByRole('link', { name: `Plan again: ${sourceTitle}` }).click();
    await settle(native);
    const adjust = native.getByRole('form', { name: 'Preview a meal plan' });
    await adjust.getByLabel('Meal name').fill(copyTitle);
    await adjust.getByLabel('New date').fill('2099-12-28');
    await adjust.getByRole('button', { name: 'Preview plan' }).click();
    await expect(native.getByRole('region', { name: 'Plan preview', exact: true })).toContainText(copyTitle);
    await native.getByRole('button', { name: 'Save this plan' }).click();
    await expect(native.getByRole('heading', { name: 'Meals for 2099-12-28' })).toBeVisible();
    await expect(day(native, '2099-12-28').getByRole('article').filter({ hasText: copyTitle })).toBeVisible();
  } finally { await context.close(); }
});
