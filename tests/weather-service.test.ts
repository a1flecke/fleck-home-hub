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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('weather service freshness and caching', () => {
  it('marks a provider snapshot as fresh', async () => {
    const times = clock();
    const service = createWeatherService({ provider: providerFrom(reading()), now: times.now });

    const result = await service.getCurrent();

    expect(result).toMatchObject({ ok: true, weather: { fresh: true, stale: false } });
  });

  it('serves an aging snapshot immediately and refreshes it behind the response', async () => {
    const times = clock();
    const gate = deferred<WeatherReading>();
    let index = 0;
    const provider = {
      read: vi.fn(async () => {
        index += 1;
        if (index === 1) {
          return reading({ today: { date: '2026-11-01', highF: 66, lowF: 58, description: 'First' } });
        }
        return await gate.promise;
      }),
    };
    const service = createWeatherService({ provider, now: times.now });
    await service.getCurrent();
    times.advance(DEFAULT_CACHE_TTL_MS + 1);

    const aging = await service.getCurrent();

    expect(aging).toMatchObject({
      ok: true,
      weather: {
        fresh: false,
        stale: false,
        today: { description: 'First' },
      },
    });
    expect(provider.read).toHaveBeenCalledTimes(2);

    gate.resolve(reading({ today: { date: '2026-11-01', highF: 70, lowF: 60, description: 'Second' } }));
    await service.refresh();
    const refreshed = await service.getCurrent();

    expect(refreshed).toMatchObject({
      ok: true,
      weather: {
        fresh: true,
        stale: false,
        today: { description: 'Second' },
      },
    });
  });

  it('waits for one bounded attempt when no snapshot exists', async () => {
    const gate = deferred<WeatherReading>();
    const provider = { read: vi.fn(() => gate.promise) };
    const service = createWeatherService({ provider, now: clock().now });
    let settled = false;

    const pending = service.getCurrent().then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    gate.resolve(reading());
    const result = await pending;

    expect(result).toMatchObject({ ok: true, weather: { fresh: true } });
    expect(provider.read).toHaveBeenCalledTimes(1);
  });

  it('does not serve a snapshot older than the maximum stale window', async () => {
    const times = clock();
    let fail = false;
    const provider = {
      read: async () => {
        if (fail) throw new WeatherProviderError('network');
        return reading();
      },
    };
    const service = createWeatherService({ provider, now: times.now });
    await service.getCurrent();
    fail = true;
    times.advance(DEFAULT_MAX_STALE_MS + 1);

    const result = await service.getCurrent();

    expect(result).toMatchObject({ ok: false, reason: 'network' });
  });

  it('returns a timestamped, non-stale snapshot from the provider', async () => {
    const times = clock();
    const service = createWeatherService({ provider: providerFrom(reading()), now: times.now });

    const result = await service.getCurrent();

    expect(result).toEqual({
      ok: true,
      weather: { ...reading(), fetchedAt: '2026-11-01T13:44:42.000Z', fresh: true, stale: false },
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
      weather: { fetchedAt: '2026-11-01T13:44:42.000Z', fresh: true, stale: false },
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
    const result = await service.backgroundTick();

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

    const result = await service.refresh({ retries: false });

    expect(result).toEqual({
      ok: true,
      weather: { ...reading(), fetchedAt: '2026-11-01T13:44:42.000Z', fresh: false, stale: true },
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

    const result = await service.refresh({ retries: false });

    expect(result).toMatchObject({ ok: true, weather: { fresh: false, stale: true } });
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
    expect(await service.refresh({ retries: false })).toMatchObject({ ok: true, weather: { stale: true } });

    fail = false;
    times.advance(1);
    const result = await service.refresh({ retries: false });

    expect(result).toMatchObject({
      ok: true,
      weather: {
        fetchedAt: '2026-11-01T13:54:42.002Z',
        stale: false,
        today: { description: 'Recovered' },
      },
    });
  });

  it('does not expose the cached snapshot to consumer mutation', async () => {
    const times = clock();
    const provider = providerFrom(reading());
    const service = createWeatherService({ provider, now: times.now });

    const first = await service.getCurrent();
    if (first.ok) first.weather.stale = true;
    const second = await service.getCurrent();

    expect(provider.read).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ ok: true, weather: { stale: false } });
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
    await service.backgroundTick();

    expect(provider.read).toHaveBeenCalledTimes(2);
  });
});

describe('weather service retries and circuit breaker', () => {
  function retryService(provider: WeatherProvider, times: ReturnType<typeof clock>, overrides = {}) {
    const sleeps: number[] = [];
    const service = createWeatherService({
      provider,
      now: times.now,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0.5,
      ...overrides,
    });
    return { service, sleeps };
  }

  it('retries timeout and network failures with bounded backoff', async () => {
    const times = clock();
    let attempt = 0;
    const provider = {
      read: vi.fn(async () => {
        attempt += 1;
        if (attempt === 1) throw new WeatherProviderError('timeout');
        if (attempt === 2) throw new WeatherProviderError('network');
        return reading();
      }),
    };
    const { service, sleeps } = retryService(provider, times);

    const result = await service.refresh({ retries: true });

    expect(result).toMatchObject({ ok: true, weather: { fresh: true } });
    expect(provider.read).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([500, 2_000]);
  });

  it('does not retry a cold read with no snapshot', async () => {
    const times = clock();
    const provider = {
      read: vi.fn(async () => {
        throw new WeatherProviderError('timeout');
      }),
    };
    const { service, sleeps } = retryService(provider, times);

    await service.getCurrent();

    expect(provider.read).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it('does not retry an unusable provider response', async () => {
    const times = clock();
    const provider = {
      read: vi.fn(async () => {
        throw new WeatherProviderError('invalid_response');
      }),
    };
    const { service, sleeps } = retryService(provider, times);

    const result = await service.refresh({ retries: true });

    expect(result).toMatchObject({ ok: false, reason: 'invalid_response' });
    expect(provider.read).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it('returns the final safe failure after exhausting retries', async () => {
    const times = clock();
    const provider = {
      read: vi.fn(async () => {
        throw new WeatherProviderError('timeout');
      }),
    };
    const { service } = retryService(provider, times);

    const result = await service.refresh({ retries: true });

    expect(result).toEqual({
      ok: false,
      reason: 'timeout',
      message: 'Weather data timed out.',
    });
    expect(provider.read).toHaveBeenCalledTimes(3);
  });

  it('opens after three failed refresh cycles and skips the provider while open', async () => {
    const times = clock();
    const provider = {
      read: vi.fn(async () => {
        throw new WeatherProviderError('network');
      }),
    };
    const { service } = retryService(provider, times, {
      retryDelaysMs: [],
      failureThreshold: 3,
      breakerCooldownMs: 15 * 60_000,
      retryCooldownMs: 0,
    });

    await service.refresh({ retries: false });
    times.advance(1);
    await service.refresh({ retries: false });
    times.advance(1);
    await service.refresh({ retries: false });
    expect(provider.read).toHaveBeenCalledTimes(3);

    times.advance(1);
    const blocked = await service.refresh({ retries: false });

    expect(blocked).toMatchObject({ ok: false, reason: 'network' });
    expect(provider.read).toHaveBeenCalledTimes(3);
  });

  it('closes the breaker after a successful half-open probe', async () => {
    const times = clock();
    let fail = true;
    const provider = {
      read: vi.fn(async () => {
        if (fail) throw new WeatherProviderError('timeout');
        return reading();
      }),
    };
    const { service } = retryService(provider, times, {
      retryDelaysMs: [],
      failureThreshold: 3,
      breakerCooldownMs: 15 * 60_000,
      retryCooldownMs: 0,
    });
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await service.refresh({ retries: false });
      times.advance(1);
    }
    expect(provider.read).toHaveBeenCalledTimes(3);

    times.advance(15 * 60_000);
    fail = false;
    const probe = await service.refresh({ retries: true });

    expect(probe).toMatchObject({ ok: true, weather: { fresh: true } });
    expect(provider.read).toHaveBeenCalledTimes(4);

    await service.refresh({ retries: false });
    expect(provider.read).toHaveBeenCalledTimes(5);
  });

  it('doubles the cooldown after a failed half-open probe', async () => {
    const times = clock();
    let fail = true;
    const provider = {
      read: vi.fn(async () => {
        if (fail) throw new WeatherProviderError('network');
        return reading();
      }),
    };
    const { service } = retryService(provider, times, {
      retryDelaysMs: [],
      failureThreshold: 3,
      breakerCooldownMs: 15 * 60_000,
      retryCooldownMs: 0,
    });
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await service.refresh({ retries: false });
      times.advance(1);
    }

    times.advance(15 * 60_000);
    await service.refresh({ retries: true });
    expect(provider.read).toHaveBeenCalledTimes(4);

    times.advance(14 * 60_000);
    await service.refresh({ retries: false });
    expect(provider.read).toHaveBeenCalledTimes(4);

    times.advance(16 * 60_000);
    fail = false;
    await service.refresh({ retries: false });
    expect(provider.read).toHaveBeenCalledTimes(5);
  });

  it('resets the failure count after a successful refresh', async () => {
    const times = clock();
    let fail = false;
    const provider = {
      read: vi.fn(async () => {
        if (fail) throw new WeatherProviderError('network');
        return reading();
      }),
    };
    const { service } = retryService(provider, times, {
      retryDelaysMs: [],
      failureThreshold: 3,
      breakerCooldownMs: 15 * 60_000,
      retryCooldownMs: 0,
    });

    fail = true;
    await service.refresh({ retries: false });
    await service.refresh({ retries: false });
    fail = false;
    await service.refresh({ retries: false });
    fail = true;
    await service.refresh({ retries: false });
    await service.refresh({ retries: false });

    expect(provider.read).toHaveBeenCalledTimes(5);
    const thirdFailure = await service.refresh({ retries: false });
    expect(thirdFailure).toMatchObject({ ok: true, weather: { fresh: false, stale: true } });
    expect(provider.read).toHaveBeenCalledTimes(6);

    const blocked = await service.refresh({ retries: false });
    expect(blocked).toMatchObject({ ok: false, reason: 'network' });
    expect(provider.read).toHaveBeenCalledTimes(6);
  });

  it('serves the last snapshot to reads while the breaker is open', async () => {
    const times = clock();
    let fail = false;
    const provider = {
      read: vi.fn(async () => {
        if (fail) throw new WeatherProviderError('network');
        return reading();
      }),
    };
    const { service } = retryService(provider, times, {
      retryDelaysMs: [],
      failureThreshold: 3,
      breakerCooldownMs: 15 * 60_000,
      retryCooldownMs: 0,
    });
    await service.getCurrent();

    fail = true;
    for (let cycle = 0; cycle < 3; cycle += 1) {
      times.advance(1);
      await service.refresh({ retries: false });
    }
    expect(provider.read).toHaveBeenCalledTimes(4);

    times.advance(1);
    const read = await service.getCurrent();

    expect(read).toMatchObject({ ok: true, weather: { fresh: false, stale: true } });
    expect(provider.read).toHaveBeenCalledTimes(4);
  });

  it('leaves fresh weather alone on a background tick', async () => {
    const times = clock();
    const provider = providerFrom(reading());
    const service = createWeatherService({ provider, now: times.now });
    await service.getCurrent();

    await expect(service.backgroundTick()).resolves.toBeNull();

    expect(provider.read).toHaveBeenCalledTimes(1);
  });

  it('refreshes aging weather on a background tick', async () => {
    const times = clock();
    const provider = providerFrom(
      reading({ today: { date: '2026-11-01', highF: 66, lowF: 58, description: 'First' } }),
      reading({ today: { date: '2026-11-01', highF: 70, lowF: 60, description: 'Second' } }),
    );
    const service = createWeatherService({ provider, now: times.now });
    await service.getCurrent();
    times.advance(DEFAULT_CACHE_TTL_MS);

    const result = await service.backgroundTick();

    expect(result).toMatchObject({ ok: true, weather: { fresh: true, today: { description: 'Second' } } });
    expect(provider.read).toHaveBeenCalledTimes(2);
  });
});
