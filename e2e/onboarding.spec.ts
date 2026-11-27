import { expect, test, type Page } from '@playwright/test';
import { hydrated, settle } from './support/navigation';

const origin = 'http://127.0.0.1:4174';
const setupCode = 'synthetic-setup-code-'.repeat(3).slice(0, 43);
const parentPassword = 'synthetic-onboarding-parent-password';
const childPassword = 'synthetic-onboarding-child-password';

async function signInParent(page: Page, email: string) {
  await page.goto(origin + '/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(parentPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Parent dashboard', { exact: true })).toBeVisible();
}

async function beforeHydration(page: Page, path: '/setup' | '/onboarding', edit: () => Promise<void>) {
  const module = `**/src/routes${path}/+page.svelte*`;
  const gate = Promise.withResolvers<void>();
  const requested = Promise.withResolvers<void>();
  await page.route(module, async route => {
    requested.resolve();
    await gate.promise;
    await route.continue();
  });
  try {
    await page.goto(origin + path, { waitUntil: 'commit' });
    await requested.promise;
    await edit();
    gate.resolve();
    await hydrated(page);
  } finally {
    gate.resolve();
    await page.unroute(module);
  }
}

test('a family starts with a blank hub and reaches a real dashboard', async ({ browser, page }, testInfo) => {
  const phone = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 812 } });
  const spouse = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Pacific/Honolulu' });
  const child = await browser.newContext({ javaScriptEnabled: false });
  try {
    const setup = await phone.newPage();
    const delay = await spouse.newPage();
    const householdForm = delay.getByRole('form', { name: 'Create household' });
    const timeZone = householdForm.getByLabel('Time zone');
    await beforeHydration(delay, '/setup', async () => {
      await householdForm.getByLabel('Family name').fill('Hydration Test Family');
      await timeZone.focus();
      await timeZone.evaluate(input => (input as HTMLInputElement).select());
    });
    await delay.keyboard.insertText('America/Denver');
    await expect(timeZone).toHaveValue('America/Denver');
    await householdForm.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(delay.getByRole('heading', { name: 'Create your parent account' })).toBeVisible();
    await expect(delay.getByText(/manage Hydration Test Family/)).toBeVisible();
    await delay.close();
    await setup.goto(origin);
    await expect(setup.getByRole('heading', { name: 'Welcome to your family’s home hub' })).toBeVisible();
    await expect(setup.getByRole('region', { name: 'Sample family display' })).toHaveCount(0);
    expect((await setup.request.post(origin + '/api/auth/sign-up/email', {
      headers: { origin }, data: { name: 'Denied', email: 'denied@example.test', password: parentPassword }
    })).ok()).toBe(false);
    await setup.getByRole('link', { name: 'Set up our family' }).click();
    await settle(setup);
    await setup.getByLabel('Family name').fill('Maple Family');
    await setup.getByLabel('Time zone').fill('America/Denver');
    await setup.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(setup.getByRole('heading', { name: 'Create your parent account' })).toBeVisible();
    await setup.getByLabel('Your name').fill('Avery');
    await setup.getByLabel('Email address').fill('avery@example.test');
    const credentials = async (code: string) => {
      await setup.getByLabel('Password', { exact: true }).fill(parentPassword);
      await setup.getByLabel('Confirm password', { exact: true }).fill(parentPassword);
      await setup.getByLabel('Setup code').fill(code);
    };
    await credentials('x'.repeat(43));
    await setup.getByRole('button', { name: 'Create account' }).click();
    await expect(setup.getByRole('alert')).toContainText('current setup code');
    await expect(setup.getByLabel('Your name')).toHaveValue('Avery');
    await expect(setup.getByLabel('Setup code')).toHaveValue('');
    await credentials(setupCode);
    await setup.getByRole('button', { name: 'Create account' }).click();
    await expect(setup.getByRole('heading', { name: 'Invite another parent' })).toBeVisible();
    await expect(setup.getByText('Maple Family · Step 1 of 3')).toBeVisible();
    await setup.screenshot({ path: testInfo.outputPath('onboarding-parent-mobile.png') });

    await setup.getByRole('button', { name: 'Create parent invitation' }).click();
    await expect(setup.getByRole('status')).toContainText('ready to share');
    const originalInvite = await setup.getByLabel('Share this link').inputValue();
    await setup.getByText('Replace the pending link', { exact: true }).click();
    await setup.getByRole('button', { name: 'Replace invitation', exact: true }).click();
    await expect(setup.getByRole('status')).toContainText('ready to share');
    const invite = await setup.getByLabel('Share this link').inputValue();
    expect(invite).not.toBe(originalInvite);
    await expect(setup.getByRole('region', { name: 'Parent invitations' })).toContainText('Replaced or revoked');
    await expect(setup.getByRole('region', { name: 'Parent invitations' })).toContainText('Pending');
    const partner = await spouse.newPage();
    await partner.goto(invite);
    const join = partner.getByRole('button', { name: 'Create account' });
    await expect(join).toBeEnabled();
    await partner.getByLabel('Name', { exact: true }).fill('Quinn');
    await partner.getByLabel('Email').fill('quinn@example.test');
    await partner.getByLabel('Password', { exact: true }).fill(parentPassword);
    await join.click();
    await expect(partner.getByText('Your account is ready.')).toBeVisible();
    await signInParent(partner, 'quinn@example.test');
    await expect(partner.getByRole('heading', { name: 'Hello, Quinn' })).toBeVisible();
    await setup.goto(origin + '/onboarding');
    await expect(setup.getByRole('region', { name: 'Parent invitations' })).toContainText('Accepted');
    await setup.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(setup.getByRole('heading', { name: 'Add your children' })).toBeVisible();

    const addChild = setup.getByRole('form', { name: 'Add a child' });
    await addChild.getByLabel('Child’s name').fill('River');
    await addChild.getByRole('button', { name: 'Add child' }).click();
    await expect(setup.getByRole('article', { name: 'River' })).toContainText('Sign-in not set up yet');
    const addWithSignIn = partner.getByRole('form', { name: 'Add a child' });
    await beforeHydration(partner, '/onboarding', async () => {
      await addWithSignIn.getByLabel('Child’s name').fill('Sky');
      await addWithSignIn.getByText('Set up sign-in now').click();
      await addWithSignIn.getByLabel('Username', { exact: true }).fill('sky-maple');
      await addWithSignIn.getByLabel('Password', { exact: true }).fill(childPassword);
      await addWithSignIn.getByLabel('Confirm password', { exact: true }).fill(childPassword);
    });
    await expect(addWithSignIn.getByLabel('Username', { exact: true })).toBeVisible();
    await expect(addWithSignIn.getByLabel('Username', { exact: true })).toHaveValue('sky-maple');
    await addWithSignIn.getByLabel('Confirm password', { exact: true }).fill('different-synthetic-password');
    await addWithSignIn.getByRole('button', { name: 'Add child' }).click();
    await expect(partner.getByRole('alert')).toContainText('passwords didn’t match');
    await expect(addWithSignIn.getByLabel('Child’s name')).toHaveValue('Sky');
    await expect(addWithSignIn.getByLabel('Username', { exact: true })).toHaveValue('sky-maple');
    await addWithSignIn.getByLabel('Password', { exact: true }).fill(childPassword);
    await addWithSignIn.getByLabel('Confirm password', { exact: true }).fill(childPassword);
    await addWithSignIn.getByRole('button', { name: 'Add child' }).click();
    await expect(partner.getByRole('article', { name: 'Sky' })).toContainText('Username: sky-maple');

    const childPage = await child.newPage();
    await childPage.goto(origin + '/sign-in/child');
    await childPage.getByLabel('Username').fill('sky-maple');
    await childPage.getByLabel('Password').fill(childPassword);
    await childPage.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(childPage.getByRole('heading', { name: "Sky's My Day" })).toBeVisible();
    expect((await childPage.request.get(origin + '/settings/children')).status()).toBe(403);
    const response = await childPage.request.get(origin + '/api/auth/get-session');
    expect(response.status()).toBe(200);
    const session = await response.json();
    expect(session.user.name).toBe('Sky');
    expect(session.user.email).toBeUndefined();
    expect(session.session.token).toBeUndefined();

    await setup.getByRole('link', { name: 'Fleck Home Hub' }).click();
    await settle(setup);
    await setup.getByRole('button', { name: 'Sign out' }).click();
    await expect(setup.getByRole('heading', { name: 'Welcome home' })).toBeVisible();
    await signInParent(page, 'avery@example.test');
    await page.getByRole('link', { name: 'Continue family setup' }).click();
    await settle(page);
    await expect(page.getByRole('heading', { name: 'Add your children' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('article', { name: 'River' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Sky' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Try something together' })).toBeVisible();
    await page.getByRole('link', { name: 'Add groceries' }).click();
    await settle(page);
    const grocery = page.getByRole('form', { name: 'Add grocery item' });
    await grocery.getByLabel('Item', { exact: true }).fill('Maple oatmeal');
    await grocery.getByRole('button', { name: 'Add item' }).click();
    await expect(page.getByRole('article').filter({ hasText: 'Maple oatmeal' })).toBeVisible();

    await page.goto(origin + '/dashboard');
    await page.getByRole('link', { name: 'Continue family setup' }).click();
    await settle(page);
    await expect(page.getByRole('heading', { name: 'Try something together' })).toBeVisible();
    await page.getByRole('button', { name: 'Go to our dashboard' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome home!' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continue family setup' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Groceries', exact: true }).click();
    await settle(page);
    await expect(page.getByRole('article').filter({ hasText: 'Maple oatmeal' })).toBeVisible();
    await page.goto(origin + '/setup');
    await expect(page).toHaveURL(origin + '/sign-in');
  } finally {
    await Promise.all([phone.close(), spouse.close(), child.close()]);
  }
});
