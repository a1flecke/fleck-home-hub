import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_MAX_STALE_MS,
  WeatherProviderError,
  createWeatherService,
  type WeatherProvider,
  type WeatherReading,
} from '../src/lib/weather';

const start = Date.parse('2026-11-01T13:44:42Z');

function reading(overrides: Partial<WeatherReading> = {}): WeatherReading {
  return {
    timeZone: 'America/Chicago',
    forecastUpdatedAt: '2026-11-01T13:26:32.000Z',
    current: {
      temperatureF: 55,
      description: 'Patchy Fog',
      periodStart: '2026-11-01T07:00:00-06:00',
    },
    today: {
      date: '2026-11-01',
      highF: 66,
      lowF: 58,
      description: 'Patchy Fog then Mostly Cloudy',
    },
    ...overrides,
  };
}

function clock(from = start) {
  let value = from;
  return {
    now: () => new Date(value),
    advance: (ms: number) => {
      value += ms;
    },
  };
}

function providerFrom(...readings: WeatherReading[]): WeatherProvider & { read: ReturnType<typeof vi.fn> } {
  let index = 0;
  const read = vi.fn(async () => {
    const next = readings[Math.min(index, readings.length - 1)];
    index += 1;
    if (!next) throw new Error('No fixture');
    return next;
  });
  return { read };
}

function failingProvider(reason: 'timeout' | 'network' | 'invalid_response'): WeatherProvider {
  return {
    read: async () => {
      throw new WeatherProviderError(reason);
    },
  };
}

describe('weather service freshness and caching', () => {
  it('returns a timestamped, non-stale snapshot from the provider', async () => {
    const times = clock();
    const service = createWeatherService({ provider: providerFrom(reading()), now: times.now });

    const result = await service.getCurrent();

    expect(result).toEqual({
      ok: true,
      weather: { ...reading(), fetchedAt: '2026-11-01T13:44:42.000Z', stale: false },
    });
  });

  it('serves the cached snapshot while it is still fresh', async () => {
    const times = clock();
    const provider = providerFrom(reading());
    const service = createWeatherService({ provider, now: times.now });

    await service.getCurrent();
    times.advance(DEFAULT_CACHE_TTL_MS - 1);
    const result = await service.getCurrent();

    expect(provider.read).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      weather: { fetchedAt: '2026-11-01T13:44:42.000Z', stale: false },
    });
  });

  it('refreshes once the cache TTL has elapsed', async () => {
    const times = clock();
    const provider = providerFrom(
      reading({ today: { date: '2026-11-01', highF: 66, lowF: 58, description: 'First' } }),
      reading({ today: { date: '2026-11-01', highF: 70, lowF: 60, description: 'Second' } }),
    );
    const service = createWeatherService({ provider, now: times.now });

    await service.getCurrent();
    times.advance(DEFAULT_CACHE_TTL_MS);
    const result = await service.getCurrent();

    expect(provider.read).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      ok: true,
      weather: {
        fetchedAt: '2026-11-01T13:54:42.000Z',
        stale: false,
        today: { description: 'Second', highF: 70 },
      },
    });
  });

  it('serves stale data when a refresh fails inside the stale window', async () => {
    const times = clock();
    let shouldFail = false;
    const provider: WeatherProvider = {
      read: async () => {
        if (shouldFail) throw new WeatherProviderError('timeout');
        return reading();
      },
    };
    const service = createWeatherService({ provider, now: times.now });
    await service.getCurrent();
    shouldFail = true;
    times.advance(DEFAULT_CACHE_TTL_MS + 1);

    const result = await service.getCurrent();

    expect(result).toEqual({
      ok: true,
      weather: { ...reading(), fetchedAt: '2026-11-01T13:44:42.000Z', stale: true },
    });
  });

  it('refuses stale data once it is older than the maximum stale window', async () => {
    const times = clock();
    let shouldFail = false;
    const provider: WeatherProvider = {
      read: async () => {
        if (shouldFail) throw new WeatherProviderError('network');
        return reading();
      },
    };
    const service = createWeatherService({ provider, now: times.now });
    await service.getCurrent();
    shouldFail = true;
    times.advance(DEFAULT_MAX_STALE_MS + 1);

    const result = await service.getCurrent();

    expect(result).toEqual({
      ok: false,
      reason: 'network',
      message: 'Weather data is temporarily unavailable.',
    });
  });

  it('allows stale data at the boundary of the stale window', async () => {
    const times = clock();
    let shouldFail = false;
    const provider: WeatherProvider = {
      read: async () => {
        if (shouldFail) throw new WeatherProviderError('timeout');
        return reading();
      },
    };
    const service = createWeatherService({ provider, now: times.now });
    await service.getCurrent();
    shouldFail = true;
    times.advance(DEFAULT_MAX_STALE_MS);

    const result = await service.getCurrent();

    expect(result).toMatchObject({ ok: true, weather: { stale: true } });
  });

  it('passes through unavailable current conditions without inventing a temperature', async () => {
    const times = clock();
    const service = createWeatherService({
      provider: providerFrom(reading({ current: null })),
      now: times.now,
    });

    const result = await service.getCurrent();

    expect(result).toMatchObject({ ok: true, weather: { current: null } });
    if (result.ok) expect(result.weather.current).not.toBe(0);
  });

  it('recovers with fresh data after a stale failure', async () => {
    const times = clock();
    let fail = false;
    const provider: WeatherProvider = {
      read: async () => {
        if (fail) throw new WeatherProviderError('network');
        return reading({ today: { date: '2026-11-01', highF: 70, lowF: 60, description: 'Recovered' } });
      },
    };
    const service = createWeatherService({ provider, now: times.now });
    await service.getCurrent();
    fail = true;
    times.advance(DEFAULT_CACHE_TTL_MS + 1);
    expect(await service.getCurrent()).toMatchObject({ ok: true, weather: { stale: true } });

    fail = false;
    times.advance(1);
    const result = await service.getCurrent();

    expect(result).toMatchObject({
      ok: true,
      weather: {
        fetchedAt: '2026-11-01T13:54:42.002Z',
        stale: false,
        today: { description: 'Recovered' },
      },
    });
  });

  it('keeps a real zero temperature in a snapshot', async () => {
    const times = clock();
    const service = createWeatherService({
      provider: providerFrom(reading({
        current: { temperatureF: 0, description: 'Cold', periodStart: '2026-11-01T07:00:00-06:00' },
        today: { date: '2026-11-01', highF: 0, lowF: 0, description: 'Cold' },
      })),
      now: times.now,
    });

    const result = await service.getCurrent();

    expect(result).toMatchObject({
      ok: true,
      weather: { current: { temperatureF: 0 }, today: { highF: 0, lowF: 0 } },
    });
  });

  it.each([
    ['timeout', 'Weather data timed out.'],
    ['network', 'Weather data is temporarily unavailable.'],
    ['invalid_response', 'Weather data was not usable.'],
  ] as const)('reports %s safely on a cold failure', async (reason, message) => {
    const times = clock();
    const service = createWeatherService({ provider: failingProvider(reason), now: times.now });

    const result = await service.getCurrent();

    expect(result).toEqual({ ok: false, reason, message });
    expect(JSON.stringify(result)).not.toContain('39.7456');
    expect(JSON.stringify(result)).not.toContain('api.weather.gov');
  });

  it('maps an unexpected provider failure to a safe network result', async () => {
    const times = clock();
    const service = createWeatherService({
      provider: {
        read: async () => {
          throw new Error('socket hang up for 39.7456,-97.0892');
        },
      },
      now: times.now,
    });

    const result = await service.getCurrent();

    expect(result).toEqual({
      ok: false,
      reason: 'network',
      message: 'Weather data is temporarily unavailable.',
    });
  });

  it('supports shorter cache windows for controlled consumers', async () => {
    const times = clock();
    const provider = providerFrom(reading());
    const service = createWeatherService({
      provider,
      now: times.now,
      cacheTtlMs: 1_000,
      maxStaleMs: 2_000,
    });

    await service.getCurrent();
    times.advance(1_000);
    await service.getCurrent();

    expect(provider.read).toHaveBeenCalledTimes(2);
  });
});
