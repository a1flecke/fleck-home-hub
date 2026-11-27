import { expect, test, type Page } from '@playwright/test';
import { settle } from './support/navigation';

// Read-only journeys: they search the reuse household's seeded chores and never mutate them.
// Other specs add chores whose titles start with "Clean bedroom", so match the seeded heading exactly.
const origin = 'http://127.0.0.1:4173';

const cleanBedroom = (page: Page) => page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Clean bedroom', exact: true }) });

// The cleared list is paged by recency and other specs add chores to this household, so assert what
// is always true of the destination (an empty search and at least one result) rather than which
// seeded chore is on its first page. The outgoing page shows "Showing 0 of 0".
async function expectClearedList(page: Page) {
  await expect(page.getByLabel('Search recent chores')).toHaveValue('');
  await expect(page.getByText(/^Showing [1-9]\d* of \d+ recent chores\.$/)).toBeVisible();
}

async function signIn(page: Page) {
  const response = await page.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'reuse-parent@example.test', password: 'synthetic-reuse-parent-password' } });
  expect(response.status()).toBe(200);
}

/** Holds the next unfiltered recent-chores data request until `release()` is called. */
async function holdClearedList(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let held!: () => void;
  const isHeld = new Promise<void>(resolve => { held = resolve; });
  await page.route(url => url.pathname === '/chores/week/again/__data.json' && !url.searchParams.has('q') && !url.searchParams.has('source'), async route => {
    held();
    await gate;
    await route.continue();
  }, { times: 1 });
  return { release, isHeld };
}

async function openNoMatchSearch(page: Page) {
  await page.goto('/chores/week/again?date=2099-10-04&q=no%20such%20household%20chore');
  await expect(page.locator('html')).toHaveAttribute('data-navigation', 'idle');
  await expect(page.getByRole('heading', { name: 'No chores match this search' })).toBeVisible();
}

test('the navigation marker is loading as soon as a client-side link click returns, and settle waits for the render', async ({ page }) => {
  await signIn(page);
  await openNoMatchSearch(page);
  const { release, isHeld } = await holdClearedList(page);

  // no-settle: this test inspects the in-flight navigation while its data is held
  await page.getByRole('link', { name: 'Clear search' }).click();
  await isHeld;
  await expect(page.locator('html')).toHaveAttribute('data-navigation', 'loading');
  let settled = false;
  const waiting = settle(page).then(() => { settled = true; });
  // The outgoing page is still on screen: this is the DOM a premature action would target.
  await expect(page.getByRole('heading', { name: 'No chores match this search' })).toBeVisible();
  expect(settled).toBe(false);

  release();
  await waiting;
  await expectClearedList(page);
});

test('the chore-reuse search journey settles each navigation before acting, with a late cleared list', async ({ page }) => {
  // The pattern from main CI run 45930899060, done correctly. There the fill ran while this
  // navigation landed, SvelteKit's focus reset dropped the typed text, Search re-submitted the old
  // query and the click target never appeared. That sub-millisecond interleaving cannot be forced
  // deterministically; the test above proves the property this one relies on.
  await signIn(page);
  await openNoMatchSearch(page);
  const { release, isHeld } = await holdClearedList(page);

  // no-settle: the response is still held; settle() follows once its release is scheduled
  await page.getByRole('link', { name: 'Clear search' }).click();
  await isHeld;
  setTimeout(release, 300);
  await settle(page);
  await page.getByLabel('Search recent chores').fill('Clean bedroom');
  await page.getByRole('button', { name: 'Search' }).click();
  await settle(page);
  await expect(page).toHaveURL(/[?&]q=Clean(\+|%20)bedroom/);
  await cleanBedroom(page).getByRole('link', { name: 'Use this chore' }).click();
  await settle(page);
  await expect(page.getByRole('region', { name: 'Selected chore' })).toContainText('Clean bedroom');
});

test('settle returns at once without JavaScript, where Playwright already waits for native navigation', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await signIn(page);
    await openNoMatchSearchWithoutJs(page);
    await page.getByRole('link', { name: 'Clear search' }).click();
    await settle(page);
    await expect(page.locator('html')).not.toHaveAttribute('data-navigation', /.*/);
    await expectClearedList(page);
  } finally { await context.close(); }
});

async function openNoMatchSearchWithoutJs(page: Page) {
  await page.goto('/chores/week/again?date=2099-10-04&q=no%20such%20household%20chore');
  await expect(page.getByRole('heading', { name: 'No chores match this search' })).toBeVisible();
}
