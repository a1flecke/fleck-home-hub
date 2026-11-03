import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createEvent } from '../src/lib/server/calendar';
import { createChore } from '../src/lib/server/chores';
import { localDate } from '../src/lib/chores/recurrence';
import { setDisplayVisibility } from '../src/lib/server/display';
import { loadDisplay } from '../src/lib/server/display-view';
import { createDisplayWeatherSource, type DisplayWeather } from '../src/lib/server/display-weather';
import { createAuth, migrate } from '../src/lib/server/identity';

const databases: Database.Database[] = [];
const secret = 'a-long-random-test-secret-for-synthetic-weather-only';
const origin = 'http://localhost:3000';

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const post = (path: string, body: unknown) =>
  new Request(`${origin}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });

async function user(auth: ReturnType<typeof createAuth>, name: string, email: string) {
  const response = await auth.handler(post('sign-up/email', { name, email, password: 'synthetic-password-123' }));
  expect(response.status).toBe(200);
  return (await response.json()).user as { id: string };
}

async function signIn(auth: ReturnType<typeof createAuth>, email: string) {
  const response = await auth.handler(post('sign-in/email', { email, password: 'synthetic-password-123' }));
  expect(response.status).toBe(200);
  return response.headers.get('set-cookie')!.split(';')[0];
}

const weather: DisplayWeather = {
  status: 'available',
  timeZone: 'America/Chicago',
  temperatureF: 55,
  description: 'Patchy Fog',
  highF: 66,
  lowF: 58,
  fresh: true,
  stale: false,
  fetchedAt: '2026-11-01T13:44:42.000Z',
  forecastUpdatedAt: '2026-11-01T13:26:32.000Z',
  retrievedAtLabel: 'Nov 1, 1:44 PM',
  forecastUpdatedLabel: 'Nov 1, 8:26 AM',
};

async function scenario() {
  const db = new Database(':memory:');
  databases.push(db);
  db.pragma('foreign_keys = ON');
  await migrate(db);
  const auth = createAuth(db, { secret, origin, allowSignUp: true });
  const parent = await user(auth, 'Synthetic Parent', 'weather-parent@example.test');
  const kid = await user(auth, 'Synthetic Kid', 'weather-kid@example.test');
  await user(auth, 'Synthetic Outsider', 'weather-outsider@example.test');
  db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run('home', 'Synthetic Home');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(parent.id, 'home', 'parent');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(kid.id, 'home', 'kid');
  const today = localDate(new Date(), 'America/Chicago');
  const event = createEvent(db, parent.id, 'home', {
    title: 'Shared weather-day event',
    date: today,
    allDay: true,
    description: 'Private event details',
    location: 'Private location',
  });
  const chore = createChore(db, parent.id, 'home', {
    title: 'Shared weather-day chore',
    description: 'Private chore details',
    assigneeId: kid.id,
    dueDate: today,
    rewardCents: 200,
  });
  setDisplayVisibility(db, parent.id, 'home', 'event', event, true);
  setDisplayVisibility(db, parent.id, 'home', 'chore', chore, true);
  const services = { db, auth, origin };
  return {
    services,
    kidCookie: await signIn(auth, 'weather-kid@example.test'),
    outsiderCookie: await signIn(auth, 'weather-outsider@example.test'),
  };
}

function request(cookie?: string) {
  return new Request(`${origin}/display/data`, { headers: cookie ? { cookie } : {} });
}

describe('family display weather composition', () => {
  it('includes weather alongside authorized household data without widening the privacy projection', async () => {
    const { services, kidCookie } = await scenario();

    const data = await loadDisplay(request(kidCookie), { services, weather: async () => weather });

    expect(data.weather).toEqual(weather);
    expect(data.events.map((event) => event.title)).toContain('Shared weather-day event');
    expect(data.chores.map((chore) => chore.title)).toContain('Shared weather-day chore');
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain('Private event details');
    expect(serialized).not.toContain('Private location');
    expect(serialized).not.toContain('Private chore details');
    expect(serialized).not.toMatch(/reward|assignee/i);
  });

  it('keeps household events and chores when a provider request times out', async () => {
    const { services, kidCookie } = await scenario();
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }) as typeof fetch;
    const source = createDisplayWeatherSource({
      env: {
        WEATHER_LATITUDE: '39.7456',
        WEATHER_LONGITUDE: '-97.0892',
        WEATHER_TIMEOUT_MS: '100',
      },
      fetch: fetchImpl,
      now: () => new Date('2026-11-01T13:44:42Z'),
      backgroundRefresh: false,
    });

    const data = await loadDisplay(request(kidCookie), { services, weather: () => source.get() });

    expect(data.weather).toEqual({ status: 'unavailable' });
    expect(data.events.map((event) => event.title)).toContain('Shared weather-day event');
    expect(data.chores.map((chore) => chore.title)).toContain('Shared weather-day chore');
  });

  it('does not let a throwing weather loader or its details break or leak into the display', async () => {
    const { services, kidCookie } = await scenario();

    const data = await loadDisplay(request(kidCookie), {
      services,
      weather: async () => {
        throw new Error('socket hang up for 39.7456,-97.0892 at https://api.weather.gov');
      },
    });

    expect(data.weather).toEqual({ status: 'unavailable' });
    expect(data.events.map((event) => event.title)).toContain('Shared weather-day event');
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain('39.7456');
    expect(serialized).not.toContain('api.weather.gov');
    expect(serialized).not.toContain('socket hang up');
  });

  it('redirects anonymous requests before asking for weather', async () => {
    const { services } = await scenario();
    let called = false;

    await expect(
      loadDisplay(request(), {
        services,
        weather: async () => {
          called = true;
          return weather;
        },
      }),
    ).rejects.toMatchObject({ status: 303, location: '/sign-in' });
    expect(called).toBe(false);
  });

  it('rejects signed-in users without household membership before asking for weather', async () => {
    const { services, outsiderCookie } = await scenario();
    let called = false;

    await expect(
      loadDisplay(request(outsiderCookie), {
        services,
        weather: async () => {
          called = true;
          return weather;
        },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(called).toBe(false);
  });
});
