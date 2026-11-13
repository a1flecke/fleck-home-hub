import { expect, test, type Browser } from '@playwright/test';

const base = 'http://127.0.0.1:4173';
async function device(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('session-kid@example.test');
  await page.getByLabel('Password').fill('synthetic-session-kid-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: "Session Kid's My Day" })).toBeVisible();
  return { context, page };
}

test('a user signs out one other device, then all others, against real sessions', async ({ browser }, testInfo) => {
  const phone = await device(browser), laptop = await device(browser), tablet = await device(browser);
  try {
    await phone.page.goto('/settings/sessions');
    await expect(phone.page.getByRole('heading', { name: 'Signed-in devices' })).toBeVisible();
    await expect(phone.page.getByText(/· This device/)).toHaveCount(1);
    const token = (await phone.context.cookies()).find((cookie) => cookie.name.includes('session_token'))?.value ?? '';
    expect(token.length).toBeGreaterThan(10);
    expect(await phone.page.content()).not.toContain(token.split('.')[0]);
    const rows = phone.page.getByRole('listitem').filter({ hasText: 'Signed in' });
    await expect(rows).toHaveCount(3);
    const other = rows.filter({ hasNotText: /· This device/ }).first();
    await other.getByText('Sign out this device').click();
    await other.getByRole('button', { name: /Confirm sign out of/ }).click();
    await expect(phone.page.getByRole('status')).toContainText('was signed out');
    await expect(rows).toHaveCount(2);
    await phone.page.screenshot({ path: testInfo.outputPath('sessions-mobile.png') });
    const forged = await phone.page.request.post('/settings/sessions?/revoke', { form: { id: 'not-a-session' }, headers: { origin: base } });
    expect(JSON.stringify(await forged.json())).toContain('already gone');
    const crossOrigin = await phone.page.request.post('/settings/sessions?/revokeOthers', { form: {}, headers: { origin: 'https://attacker.example.test' } });
    expect(crossOrigin.status()).toBe(403);
    await phone.page.getByText('Sign out all other devices').click();
    await phone.page.getByRole('button', { name: 'Confirm sign out of all other devices' }).click();
    await expect(phone.page.getByRole('status')).toContainText('All other devices were signed out');
    await expect(rows).toHaveCount(1);
    const survivors = await Promise.all([laptop, tablet].map(async ({ page }) => (await page.request.get('/dashboard', { maxRedirects: 0 })).status()));
    expect(survivors.filter((status) => status === 200).length).toBe(0);
    expect((await phone.page.request.get('/dashboard')).status()).toBe(200);
  } finally { await phone.context.close(); await laptop.context.close(); await tablet.context.close(); }
});
