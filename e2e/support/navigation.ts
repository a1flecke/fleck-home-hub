import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Waits until no SvelteKit client-side navigation is in flight.
 *
 * Playwright waits for browser navigations, not for SvelteKit's client router: after a link
 * click or GET form submission, `click()` returns while the new page's data is still loading.
 * Acting then targets the outgoing DOM, and when the destination is the same route (a search,
 * filter, page or date change) the same inputs and buttons exist on both pages. SvelteKit also
 * blurs the focused element and resets focus when the navigation lands, which can silently drop
 * a `fill()` that is in progress.
 *
 * The root layout sets `html[data-navigation]` to `loading` in `beforeNavigate` (synchronously,
 * before `click()` returns) and to `idle` in `afterNavigate`, which runs after the DOM update
 * and focus reset. Without JavaScript the attribute is never set and there is nothing to wait
 * for: Playwright already waits for the native navigation.
 *
 * Call it after any click that navigates, before the next interaction or a read of the page.
 * Pass the page, or any locator on it (`settle(form)` waits on that locator's page).
 * A content assertion is not a substitute when that content also exists on the outgoing page.
 */
export async function settle(target: Page | Locator): Promise<void> {
  // Not `'waitForFunction' in target`: Locator gained its own element-scoped waitForFunction in
  // Playwright 1.64, which would wait on an element the navigation has just removed.
  const page = 'goto' in target ? target : target.page();
  await page.waitForFunction(() => document.documentElement.dataset.navigation !== 'loading');
}

/**
 * Waits until the page has hydrated: SvelteKit runs `afterNavigate` once the root component has
 * mounted, and the root layout records that as `html[data-navigation="idle"]`.
 *
 * Use this instead of `waitForLoadState('networkidle')`, which waits for 500 ms without network
 * activity: it says nothing about hydration and never settles while background requests continue.
 * Only call it in a context with JavaScript enabled; without JavaScript the marker never appears.
 */
export async function hydrated(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-navigation', /^(idle|loading)$/);
  await settle(page);
}
