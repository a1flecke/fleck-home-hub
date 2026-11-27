import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:4173';

async function signInApi(context: BrowserContext, email: string, password: string): Promise<string> {
  const response = await context.request.post(`${ORIGIN}/api/auth/sign-in/email`, {
    headers: { origin: ORIGIN },
    data: { email, password }
  });
  expect(response.status()).toBe(200);
  const cookies = await context.cookies(ORIGIN);
  const sessionCookie = cookies.find(cookie => cookie.name.includes('session_token'))?.value ?? '';
  expect(sessionCookie).not.toBe('');
  return sessionCookie;
}

function articleByTitle(page: Page, title: string) {
  return page.getByRole('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}

function makeIcs(events: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Synthetic//FleckHomeHub//EN',
    ...events,
    'END:VCALENDAR'
  ].join('\r\n');
}

function vevent(lines: string[]): string {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
}

test('parent imports a .ics file on mobile, edits details, and events stay private off the display while child is read-only', async ({ browser }, testInfo) => {
  const index = testInfo.repeatEachIndex;
  const holidayTitle = `Synthetic Fall Break ${index}`;
  const editedHoliday = `Synthetic Fall Break Edited ${index}`;
  const soccerTitle = `Synthetic Soccer Practice ${index}`;
  const cancelledTitle = `Synthetic Cancelled Game ${index}`;
  const holidayDate = `2098-04-0${7 + (index % 2)}`;
  const soccerDate = `2098-04-0${8 + (index % 2)}`;
  const soccerCompact = soccerDate.replaceAll('-', '');
  const holidayCompact = holidayDate.replaceAll('-', '');

  const ics = makeIcs([
    vevent([
      `UID:e2e-holiday-${index}@example.test`,
      `SUMMARY:${holidayTitle}`,
      `DTSTART;VALUE=DATE:${holidayCompact}`,
      `DTEND;VALUE=DATE:2098040${8 + (index % 2)}`
    ]),
    vevent([
      `UID:e2e-soccer-${index}@example.test`,
      `SUMMARY:${soccerTitle}`,
      'LOCATION:North Field',
      'DESCRIPTION:Bring shin guards',
      `DTSTART;TZID=America/New_York:${soccerCompact}T180000`,
      `DTEND;TZID=America/New_York:${soccerCompact}T193000`,
      'RRULE:FREQ=WEEKLY;BYDAY=WE,FR;COUNT=2'
    ]),
    vevent([
      `UID:e2e-cancelled-${index}@example.test`,
      `SUMMARY:${cancelledTitle}`,
      'STATUS:CANCELLED',
      `DTSTART;VALUE=DATE:${holidayCompact}`
    ])
  ]);

  const parentContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const kidContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  try {
    await signInApi(parentContext, 'parent@example.test', 'synthetic-parent-password');
    await signInApi(kidContext, 'kid@example.test', 'synthetic-kid-password');

    const page = await parentContext.newPage();
    await page.goto(`/calendar?date=${holidayDate}&view=week`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('link', { name: 'Import calendar (.ics)', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/calendar/import\\?date=${holidayDate}&view=week$`));
    await expect(page.getByRole('heading', { name: 'Import calendar (.ics)' })).toBeVisible();

    await page.getByLabel('Choose a .ics file').setInputFiles({
      name: 'school-schedule.ics',
      mimeType: 'text/calendar',
      buffer: Buffer.from(ics, 'utf8')
    });
    await page.getByRole('button', { name: 'Review events' }).click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /Review 3 events from school-schedule\.ics/ })).toBeVisible();
    await expect(page.getByText('2 to import · 1 skipped')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('calendar-import-review-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: testInfo.outputPath('calendar-import-review-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });

    const firstCard = page.locator('fieldset[data-key="ics:0"]');
    await firstCard.getByLabel('Event title').fill(editedHoliday);
    await firstCard.getByText('Details, repeat schedule, and participants').click();
    await firstCard.getByLabel('Sample Kid').check();

    const secondCard = page.locator('fieldset[data-key="ics:1"]');
    // America/New_York 18:00-19:30 -> America/Chicago 17:00-18:30
    await expect(secondCard.getByLabel('Start time')).toHaveValue('17:00');
    await expect(secondCard.getByLabel('End time')).toHaveValue('18:30');

    const cancelledCard = page.locator('fieldset[data-key="ics:2"]');
    await expect(cancelledCard.getByLabel('Skip this event')).toBeChecked();

    await page.getByRole('button', { name: 'Import selected events' }).click();
    await expect(page).toHaveURL(new RegExp(`/calendar\\?date=${holidayDate}&view=week&added=2&skipped=1$`));
    await expect(page.getByRole('status')).toContainText('Imported 2 events (1 skipped).');
    await expect(articleByTitle(page, editedHoliday)).toBeVisible();
    await expect(articleByTitle(page, soccerTitle).first()).toBeVisible();
    await expect(articleByTitle(page, cancelledTitle)).toHaveCount(0);

    // Imported events remain private (never auto-shared to /display)
    const displayResponse = await parentContext.request.get(`${ORIGIN}/display/data`);
    expect(displayResponse.status()).toBe(200);
    const displayJson = JSON.stringify(await displayResponse.json());
    expect(displayJson).not.toContain(editedHoliday);
    expect(displayJson).not.toContain(soccerTitle);

    // Child sees imported events read-only, sees no import link, and is blocked at /calendar/import
    const kidPage = await kidContext.newPage();
    await kidPage.goto(`/calendar?date=${holidayDate}&view=week`);
    await expect(articleByTitle(kidPage, editedHoliday)).toBeVisible();
    await expect(kidPage.getByRole('link', { name: 'Import calendar (.ics)' })).toHaveCount(0);
    const kidImportRes = await kidContext.request.get(`${ORIGIN}/calendar/import`, { maxRedirects: 0 });
    expect(kidImportRes.status()).toBe(403);
  } finally {
    await parentContext.close();
    await kidContext.close();
  }
});

test('calendar import paste, validation recovery, and confirmation work without JavaScript', async ({ browser }, testInfo) => {
  const index = testInfo.repeatEachIndex;
  const title = `Synthetic No-JS Recital ${index}`;
  const date = `2098-05-0${4 + (index % 3)}`;
  const compact = date.replaceAll('-', '');
  const ics = makeIcs([
    vevent([
      `UID:e2e-nojs-${index}@example.test`,
      `SUMMARY:${title}`,
      `DTSTART:${compact}T150000`,
      `DTEND:${compact}T160000`
    ])
  ]);

  const authContext = await browser.newContext();
  let noJsContext: BrowserContext | undefined;
  try {
    await signInApi(authContext, 'parent@example.test', 'synthetic-parent-password');
    noJsContext = await browser.newContext({
      javaScriptEnabled: false,
      storageState: await authContext.storageState(),
      viewport: { width: 375, height: 812 }
    });
    const page = await noJsContext.newPage();
    await page.goto(`/calendar/import?date=${date}&view=day`);

    // 1. Malformed paste preserves textarea text on native POST
    const badIcs = 'BEGIN:VCALENDAR\nPRODID:Synthetic\nEND:VCALENDAR';
    await page.getByLabel(/Or paste iCalendar text/).fill(badIcs);
    await page.getByRole('button', { name: 'Review events' }).click();
    await expect(page.getByRole('alert')).toContainText('No calendar events');
    await expect(page.getByLabel(/Or paste iCalendar text/)).toHaveValue(badIcs);

    // 2. Valid paste -> review -> invalid time triggers native POST recovery preserving edited fields including textarea
    await page.getByLabel(/Or paste iCalendar text/).fill(ics);
    await page.getByRole('button', { name: 'Review events' }).click();
    const card = page.locator('fieldset[data-key="ics:0"]');
    await card.getByLabel('End time').fill('14:00');
    await card.getByText('Details, repeat schedule, and participants').click();
    await card.getByLabel('Location (optional)').fill('Community Hall');
    await card.getByLabel('Description (optional)').fill('Bring sheet music');
    await page.getByRole('button', { name: 'Import selected events' }).click();

    await expect(page.getByRole('alert')).toContainText('Check the title, date, times');
    await expect(card.getByLabel('Event title')).toHaveValue(title);
    await expect(card.getByLabel('Location (optional)')).toHaveValue('Community Hall');
    await expect(card.getByLabel('Description (optional)')).toHaveValue('Bring sheet music');

    // 3. Correct end time and submit natively
    await card.getByLabel('End time').fill('16:30');
    await page.getByRole('button', { name: 'Import selected events' }).click();
    await expect(page).toHaveURL(new RegExp(`/calendar\\?date=${date}&view=day&added=1&skipped=0$`));
    const saved = articleByTitle(page, title);
    await expect(saved).toBeVisible();
    await expect(saved.getByText(/15:00–16:30/)).toBeVisible();
  } finally {
    await noJsContext?.close();
    await authContext.close();
  }
});

test('pre-hydration edits, active selection, checkboxes, and open disclosures survive delayed hydration on import review', async ({ browser }, testInfo) => {
  const index = testInfo.repeatEachIndex;
  const originalTitle = `Hydration Import ${index}`;
  const replacedTitle = `Hydration Replaced ${index}`;
  const date = `2098-05-1${5 + (index % 3)}`;
  const compact = date.replaceAll('-', '');
  const ics = makeIcs([
    vevent([
      `UID:e2e-hydration-${index}@example.test`,
      `SUMMARY:${originalTitle}`,
      `DTSTART:${compact}T100000`,
      `DTEND:${compact}T110000`
    ])
  ]);

  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  let release!: () => void;
  let blocked!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { blocked = resolve; });
  try {
    await signInApi(context, 'parent@example.test', 'synthetic-parent-password');
    const page = await context.newPage();
    await page.goto(`/calendar/import?date=${date}&view=day`);
    await page.waitForLoadState('networkidle');

    // Gate module hydration for the POST ?/review response document
    await page.route('**/src/routes/calendar/import/+page.svelte*', async route => {
      blocked();
      await gate;
      await route.continue();
    });

    await page.getByLabel(/Or paste iCalendar text/).fill(ics);
    await page.getByRole('button', { name: 'Review events' }).click({ noWaitAfter: true });
    await requested;

    const card = page.locator('fieldset[data-key="ics:0"]');
    await card.getByLabel('All day').check();
    await card.getByText('Details, repeat schedule, and participants').click();
    await card.getByLabel('Location (optional)').fill('Library Room B');
    await card.getByLabel('Description (optional)').fill('Pre-hydration note');
    await card.getByLabel('Monday').check();
    await card.getByLabel('Sample Kid').check();

    // Select prefilled title before hydration and replace it afterward
    const titleInput = card.getByLabel('Event title');
    await titleInput.focus();
    await titleInput.evaluate((input: HTMLInputElement) => input.select());

    release();
    await page.waitForLoadState('networkidle');

    await page.keyboard.insertText(replacedTitle);
    await expect(titleInput).toHaveValue(replacedTitle);
    await expect(card.getByLabel('All day')).toBeChecked();
    await expect(card.locator('details')).toHaveAttribute('open', '');
    await expect(card.getByLabel('Location (optional)')).toHaveValue('Library Room B');
    await expect(card.getByLabel('Description (optional)')).toHaveValue('Pre-hydration note');
    await expect(card.getByLabel('Monday')).toBeChecked();
    await expect(card.getByLabel('Sample Kid')).toBeChecked();

    const entries = await page.locator('form[action^="?/confirm"]').evaluate(
      form => [...new FormData(form as HTMLFormElement).entries()]
    );
    expect(entries).toContainEqual(['title-0', replacedTitle]);
    expect(entries).toContainEqual(['allDay-0', 'on']);
    expect(entries).toContainEqual(['location-0', 'Library Room B']);
    expect(entries).toContainEqual(['description-0', 'Pre-hydration note']);
    expect(entries).toContainEqual(['weekday-0', '1']);
    expect(entries.some(([name]) => name === 'participant-0')).toBe(true);

    // Uncheck Monday so it imports cleanly as a single all-day event on `date`
    await card.getByLabel('Monday').uncheck();
    await page.getByRole('button', { name: 'Import selected events' }).click();
    await expect(page).toHaveURL(new RegExp(`/calendar\\?date=${date}&view=day&added=1&skipped=0$`));
    await expect(articleByTitle(page, replacedTitle)).toBeVisible();
  } finally {
    release?.();
    await context.close();
  }
});

test('two independent parent sessions detect concurrent duplicate imports and preserve edits for resolution', async ({ browser }, testInfo) => {
  const index = testInfo.repeatEachIndex;
  const title = `Concurrent Swim Meet ${index}`;
  const date = `2098-06-1${0 + (index % 5)}`;
  const compact = date.replaceAll('-', '');
  const ics = makeIcs([
    vevent([
      `UID:e2e-concurrent-${index}@example.test`,
      `SUMMARY:${title}`,
      `DTSTART;VALUE=DATE:${compact}`
    ])
  ]);

  const contextA = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const contextB = await browser.newContext({ viewport: { width: 375, height: 812 } });
  try {
    const tokenA = await signInApi(contextA, 'parent@example.test', 'synthetic-parent-password');
    const tokenB = await signInApi(contextB, 'parent@example.test', 'synthetic-parent-password');
    expect(tokenA).not.toBe(tokenB);

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    for (const p of [pageA, pageB]) {
      await p.goto(`/calendar/import?date=${date}&view=day`);
      await p.waitForLoadState('networkidle');
      await p.getByLabel(/Or paste iCalendar text/).fill(ics);
      await p.getByRole('button', { name: 'Review events' }).click();
      await p.waitForLoadState('networkidle');
    }

    // Session B confirms first
    await pageB.getByRole('button', { name: 'Import selected events' }).click();
    await expect(pageB).toHaveURL(new RegExp(`/calendar\\?date=${date}&view=day&added=1&skipped=0$`));
    await expect(articleByTitle(pageB, title)).toBeVisible();

    // Session A edits location and submits -> rejected with conflict, edit preserved, defaulted to Skip
    const cardA = pageA.locator('fieldset[data-key="ics:0"]');
    await cardA.getByText('Details, repeat schedule, and participants').click();
    await cardA.getByLabel('Location (optional)').fill('East Pool');
    await pageA.getByRole('button', { name: 'Import selected events' }).click();
    await pageA.waitForLoadState('networkidle');

    await expect(pageA.getByRole('alert')).toContainText('The calendar changed');
    await expect(cardA).toContainText('Already imported:');
    await expect(cardA.getByLabel('Location (optional)')).toHaveValue('East Pool');
    await expect(cardA.getByLabel('Skip this event')).toBeChecked();

    // Session A skips -> 0 added, 1 skipped, Session B's event remains intact
    await pageA.getByRole('button', { name: 'Import selected events' }).click();
    await expect(pageA).toHaveURL(new RegExp(`/calendar\\?date=${date}&view=day&added=0&skipped=1$`));
    await expect(articleByTitle(pageA, title)).toHaveCount(1);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
