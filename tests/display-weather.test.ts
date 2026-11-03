import { describe, expect, it, vi } from 'vitest';
import { createDisplayWeatherSource } from '../src/lib/server/display-weather';

const env = {
  WEATHER_LATITUDE: '39.7456',
  WEATHER_LONGITUDE: '-97.0892',
  WEATHER_USER_AGENT: 'fleck-home-hub-test',
};

const points = {
  properties: {
    forecast: 'https://api.weather.gov/gridpoints/TOP/32,81/forecast',
    forecastHourly: 'https://api.weather.gov/gridpoints/TOP/32,81/forecast/hourly',
    timeZone: 'America/Chicago',
  },
};

const daily = {
  properties: {
    updateTime: '2026-11-01T13:26:32+00:00',
    periods: [
      {
        startTime: '2026-11-01T07:00:00-06:00',
        isDaytime: true,
        temperature: 66,
        temperatureUnit: 'F',
        shortForecast: 'Patchy Fog then Mostly Cloudy',
      },
      {
        startTime: '2026-11-01T18:00:00-06:00',
        isDaytime: false,
        temperature: 58,
        temperatureUnit: 'F',
        shortForecast: 'Chance Rain Showers',
      },
    ],
  },
};

const hourly = {
  properties: {
    periods: [
      {
        startTime: '2026-11-01T13:00:00-06:00',
        temperature: 55,
        temperatureUnit: 'F',
        shortForecast: 'Patchy Fog',
      },
    ],
  },
};

type Fixture = { status?: number; body?: unknown; rawBody?: string; hang?: boolean; error?: Error };

function jsonResponse({ status = 200, body, rawBody }: Fixture) {
  return new Response(rawBody ?? JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/geo+json' },
  });
}

function routedFetch(fixtures: { points: Fixture; daily: Fixture; hourly: Fixture }) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    let fixture: Fixture;
    if (url.endsWith('/forecast/hourly')) fixture = fixtures.hourly;
    else if (url.endsWith('/forecast')) fixture = fixtures.daily;
    else fixture = fixtures.points;
    if (fixture.hang) {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }
    if (fixture.error) throw fixture.error;
    return jsonResponse(fixture);
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function clock(from = Date.parse('2026-11-01T13:44:42Z')) {
  let value = from;
  return {
    now: () => new Date(value),
    advance: (ms: number) => {
      value += ms;
    },
  };
}

const expectedLabels = {
  retrievedAtLabel: 'Nov 1, 7:44 AM',
  forecastUpdatedLabel: 'Nov 1, 7:26 AM',
};

describe('display weather source', () => {
  it('projects a configured snapshot into display data', async () => {
    const { fetch } = routedFetch({ points: { body: points }, daily: { body: daily }, hourly: { body: hourly } });
    const source = createDisplayWeatherSource({ env, fetch, now: clock().now });

    const result = await source.get();

    expect(result).toEqual({
      status: 'available',
      timeZone: 'America/Chicago',
      temperatureF: 55,
      description: 'Patchy Fog',
      highF: 66,
      lowF: 58,
      stale: false,
      fetchedAt: '2026-11-01T13:44:42.000Z',
      forecastUpdatedAt: '2026-11-01T13:26:32.000Z',
      ...expectedLabels,
    });
  });

  it('reports unavailable weather without contacting the provider when coordinates are missing', async () => {
    const { fetch, calls } = routedFetch({ points: { body: points }, daily: { body: daily }, hourly: { body: hourly } });
    const source = createDisplayWeatherSource({ env: {}, fetch, now: clock().now });

    await expect(source.get()).resolves.toEqual({ status: 'unavailable' });
    expect(calls).toEqual([]);
  });

  it('reports unavailable weather without contacting the provider when configuration is invalid', async () => {
    const { fetch, calls } = routedFetch({ points: { body: points }, daily: { body: daily }, hourly: { body: hourly } });
    const source = createDisplayWeatherSource({
      env: { ...env, WEATHER_LATITUDE: 'north' },
      fetch,
      now: clock().now,
    });

    await expect(source.get()).resolves.toEqual({ status: 'unavailable' });
    expect(calls).toEqual([]);
  });

  it('keeps a real zero temperature and a missing low distinct', async () => {
    const { fetch } = routedFetch({
      points: { body: points },
      daily: {
        body: {
          properties: {
            updateTime: '2026-11-01T13:26:32+00:00',
            periods: [
              { startTime: '2026-11-01T07:00:00-06:00', isDaytime: true, temperature: 0, temperatureUnit: 'F', shortForecast: 'Cold' },
              { startTime: '2026-11-01T18:00:00-06:00', isDaytime: false, temperature: null, temperatureUnit: 'F', shortForecast: 'Cold' },
            ],
          },
        },
      },
      hourly: {
        body: {
          properties: {
            periods: [{ startTime: '2026-11-01T13:00:00-06:00', temperature: 0, temperatureUnit: 'F', shortForecast: 'Cold' }],
          },
        },
      },
    });
    const source = createDisplayWeatherSource({ env, fetch, now: clock().now });

    const result = await source.get();

    expect(result).toMatchObject({
      status: 'available',
      temperatureF: 0,
      highF: 0,
      lowF: null,
    });
  });

  it('keeps the daily forecast when the hourly temperature is unavailable', async () => {
    const { fetch } = routedFetch({
      points: { body: points },
      daily: { body: daily },
      hourly: { status: 503 },
    });
    const source = createDisplayWeatherSource({ env, fetch, now: clock().now });

    const result = await source.get();

    expect(result).toMatchObject({
      status: 'available',
      temperatureF: null,
      description: 'Patchy Fog then Mostly Cloudy',
      highF: 66,
      lowF: 58,
    });
  });

  it('keeps a low when the daily high is unavailable', async () => {
    const { fetch } = routedFetch({
      points: { body: points },
      daily: {
        body: {
          properties: {
            updateTime: '2026-11-01T13:26:32+00:00',
            periods: [
              {
                startTime: '2026-11-01T18:00:00-06:00',
                isDaytime: false,
                temperature: 58,
                temperatureUnit: 'F',
                shortForecast: 'Chance Rain Showers',
              },
            ],
          },
        },
      },
      hourly: { status: 503 },
    });
    const source = createDisplayWeatherSource({ env, fetch, now: clock().now });

    const result = await source.get();

    expect(result).toMatchObject({
      status: 'available',
      temperatureF: null,
      highF: null,
      lowF: 58,
      description: 'Chance Rain Showers',
    });
  });

  it('reports an unusable provider response as unavailable weather', async () => {
    const { fetch } = routedFetch({
      points: { body: points },
      daily: { rawBody: 'not json' },
      hourly: { body: hourly },
    });
    const source = createDisplayWeatherSource({ env, fetch, now: clock().now });

    await expect(source.get()).resolves.toEqual({ status: 'unavailable' });
  });

  it('resolves a provider timeout to unavailable weather', async () => {
    const { fetch } = routedFetch({
      points: { hang: true },
      daily: { body: daily },
      hourly: { body: hourly },
    });
    const source = createDisplayWeatherSource({
      env: { ...env, WEATHER_TIMEOUT_MS: '100' },
      fetch,
      now: clock().now,
    });

    await expect(source.get()).resolves.toEqual({ status: 'unavailable' });
  });

  it('marks cached weather as an older forecast when a refresh fails', async () => {
    const times = clock();
    let fail = false;
    const { fetch } = routedFetch({
      points: {
        get body() {
          if (fail) throw new Error('socket hang up for 39.7456,-97.0892');
          return points;
        },
      },
      daily: { body: daily },
      hourly: { body: hourly },
    });
    const source = createDisplayWeatherSource({
      env,
      fetch,
      now: times.now,
      cacheTtlMs: 1_000,
      maxStaleMs: 60_000,
    });
    await source.get();
    fail = true;
    times.advance(1_001);

    const result = await source.get();

    expect(result).toMatchObject({
      status: 'available',
      stale: true,
      fetchedAt: '2026-11-01T13:44:42.000Z',
      retrievedAtLabel: 'Nov 1, 7:44 AM',
    });
  });

  it('replaces stale weather with a fresh forecast after the provider recovers', async () => {
    const times = clock();
    let fail = false;
    let temperature = 55;
    const { fetch } = routedFetch({
      points: {
        get body() {
          if (fail) throw new Error('offline');
          return points;
        },
      },
      daily: { body: daily },
      hourly: {
        get body() {
          return {
            properties: {
              periods: [{ startTime: '2026-11-01T13:00:00-06:00', temperature, temperatureUnit: 'F', shortForecast: 'Clear' }],
            },
          };
        },
      },
    });
    const source = createDisplayWeatherSource({
      env,
      fetch,
      now: times.now,
      cacheTtlMs: 1_000,
      maxStaleMs: 60_000,
    });
    await source.get();
    fail = true;
    times.advance(1_001);
    await expect(source.get()).resolves.toMatchObject({ stale: true });
    fail = false;
    temperature = 61;
    times.advance(1);

    const result = await source.get();

    expect(result).toMatchObject({
      stale: false,
      temperatureF: 61,
      fetchedAt: '2026-11-01T13:44:43.002Z',
      retrievedAtLabel: 'Nov 1, 7:44 AM',
    });
  });

  it('does not expose request details or provider exceptions in an unavailable result', async () => {
    const { fetch } = routedFetch({
      points: { error: new Error('connect ECONNREFUSED 39.7456,-97.0892 https://api.weather.gov') },
      daily: { body: daily },
      hourly: { body: hourly },
    });
    const source = createDisplayWeatherSource({ env, fetch, now: clock().now });

    const result = await source.get();
    const serialized = JSON.stringify(result);

    expect(result).toEqual({ status: 'unavailable' });
    expect(serialized).not.toContain('39.7456');
    expect(serialized).not.toContain('api.weather.gov');
    expect(serialized).not.toContain('ECONNREFUSED');
  });

  it('shares one in-flight provider request between concurrent display loads', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (!held) {
        held = true;
        await gate;
      }
      if (url.endsWith('/forecast/hourly')) return jsonResponse({ body: hourly });
      if (url.endsWith('/forecast')) return jsonResponse({ body: daily });
      return jsonResponse({ body: points });
    }) as typeof fetch;
    const source = createDisplayWeatherSource({ env, fetch: fetchImpl, now: clock().now });

    const first = source.get();
    const second = source.get();
    expect(calls).toHaveLength(1);
    release();

    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(calls).toHaveLength(3);
  });

  it('does not cache the unavailable result of an unconfigured source', async () => {
    const source = createDisplayWeatherSource({ env: {}, fetch: vi.fn() as unknown as typeof fetch });
    await expect(source.get()).resolves.toEqual({ status: 'unavailable' });
    await expect(source.get()).resolves.toEqual({ status: 'unavailable' });
  });
});
