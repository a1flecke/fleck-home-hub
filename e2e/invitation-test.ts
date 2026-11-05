import { test as base, expect } from '@playwright/test';

// Playwright 1.64.1 captures a separate aria snapshot for error-context.md even
// when traces/screenshots/video are off. Keep that snapshot out of this suite.
// A worker fixture gives these tests a separate worker pool and retains the
// setting through artifact teardown; other suites retain their diagnostics.
export const test = base.extend<object, { invitationArtifactPrivacy: void }>({
  invitationArtifactPrivacy: [async ({ browserName }, use) => {
    void browserName;
    const previous = process.env.PLAYWRIGHT_NO_COPY_PROMPT;
    process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
    try { await use(); }
    finally {
      if (previous === undefined) delete process.env.PLAYWRIGHT_NO_COPY_PROMPT;
      else process.env.PLAYWRIGHT_NO_COPY_PROMPT = previous;
    }
  }, { scope: 'worker', auto: true }]
});
export { expect };

// Navigation errors include their destination URL. Replace that error rather
// than letting a fragment token reach a reporter through the call log.
export async function openInvitation(page: import('@playwright/test').Page, link: string, options?: Parameters<import('@playwright/test').Page['goto']>[1]) {
  try { await page.goto(link, options); }
  catch { throw new Error('Unable to open synthetic invitation'); }
}
