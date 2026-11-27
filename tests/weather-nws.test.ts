import { describe, expect, it } from 'vitest';
import { createNwsWeatherProvider, WeatherProviderError } from '../src/lib/weather';

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
      {
        startTime: '2026-11-02T06:00:00-06:00',
        isDaytime: true,
        temperature: 74,
        temperatureUnit: 'F',
        shortForecast: 'Showers And Thunderstorms Likely',
      },
    ],
  },
};

const hourly = {
  properties: {
    updateTime: '2026-11-01T13:26:32+00:00',
    periods: [
      {
        startTime: '2026-11-01T07:00:00-06:00',
        temperature: 55,
        temperatureUnit: 'F',
        shortForecast: 'Patchy Fog',
      },
    ],
  },
};

const options = {
  latitude: 39.7456,
  longitude: -97.0892,
  userAgent: 'fleck-home-hub-test',
  now: () => new Date('2026-11-01T13:44:42Z'),
};

type Fixture = { status?: number; body?: unknown; rawBody?: string; hang?: boolean };

function jsonResponse({ status = 200, body, rawBody }: Fixture) {
  return new Response(rawBody ?? JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/geo+json' },
  });
}

function fakeFetch(responses: Fixture[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let index = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const response = responses[index];
    index += 1;
    if (!response) throw new Error(`Unexpected request: ${url}`);
    if (response.hang) {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }
    return jsonResponse(response);
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
    throw new Error('Expected the provider to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(WeatherProviderError);
    return error as WeatherProviderError;
  }
}

describe('NWS weather provider', () => {
  it('reads current conditions and the current forecast day from the grid forecast', async () => {
    const { fetch, calls } = fakeFetch([
      { body: points },
      { body: daily },
      { body: hourly },
    ]);

    const reading = await createNwsWeatherProvider({ ...options, fetch }).read();

    expect(reading).toEqual({
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
    });
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.weather.gov/points/39.7456,-97.0892',
      'https://api.weather.gov/gridpoints/TOP/32,81/forecast',
      'https://api.weather.gov/gridpoints/TOP/32,81/forecast/hourly',
    ]);
    expect(calls[0].init?.headers).toEqual({
      'User-Agent': 'fleck-home-hub-test',
      Accept: 'application/geo+json',
    });
  });

  it('converts Celsius periods to Fahrenheit', async () => {
    const { fetch } = fakeFetch([
      { body: points },
      {
        body: {
          properties: {
            updateTime: '2026-11-01T13:26:32+00:00',
            periods: [
              { startTime: '2026-11-01T07:00:00-06:00', isDaytime: true, temperature: 18.9, temperatureUnit: 'C', shortForecast: 'Cloudy' },
              { startTime: '2026-11-01T18:00:00-06:00', isDaytime: false, temperature: 14.4, temperatureUnit: 'C', shortForecast: 'Cloudy' },
            ],
          },
        },
      },
      {
        body: {
          properties: {
            periods: [{ startTime: '2026-11-01T07:00:00-06:00', temperature: 12.8, temperatureUnit: 'C', shortForecast: 'Cloudy' }],
          },
        },
      },
    ]);

    const reading = await createNwsWeatherProvider({ ...options, fetch }).read();

    expect(reading.current?.temperatureF).toBe(55);
    expect(reading.today.highF).toBe(66);
    expect(reading.today.lowF).toBe(58);
  });

  it('keeps a real zero temperature distinct from missing data', async () => {
    const { fetch } = fakeFetch([
      { body: points },
      {
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
      {
        body: {
          properties: {
            periods: [{ startTime: '2026-11-01T07:00:00-06:00', temperature: 0, temperatureUnit: 'F', shortForecast: 'Cold' }],
          },
        },
      },
    ]);

    const reading = await createNwsWeatherProvider({ ...options, fetch }).read();

    expect(reading.current?.temperatureF).toBe(0);
    expect(reading.today.highF).toBe(0);
    expect(reading.today.lowF).toBeNull();
  });

  it('returns a daily forecast when the hourly request is unavailable', async () => {
    const { fetch } = fakeFetch([{ body: points }, { body: daily }, { status: 503 }]);

    const reading = await createNwsWeatherProvider({ ...options, fetch }).read();

    expect(reading.current).toBeNull();
    expect(reading.today.highF).toBe(66);
  });

  it('returns a daily forecast when the hourly response is malformed', async () => {
    const { fetch } = fakeFetch([{ body: points }, { body: daily }, { rawBody: 'not json' }]);

    const reading = await createNwsWeatherProvider({ ...options, fetch }).read();

    expect(reading.current).toBeNull();
    expect(reading.today.highF).toBe(66);
  });

  it('reports an unusable daily forecast rather than inventing one', async () => {
    const { fetch } = fakeFetch([
      { body: points },
      { body: { properties: { updateTime: '2026-11-01T13:26:32+00:00', periods: [] } } },
    ]);

    const error = await failure(createNwsWeatherProvider({ ...options, fetch }).read());

    expect(error.reason).toBe('invalid_response');
    expect(error.message).not.toContain('39.7456');
    expect(error.message).not.toContain('api.weather.gov');
  });

  it('rejects a forecast without an update timestamp', async () => {
    const { fetch } = fakeFetch([
      { body: points },
      { body: { properties: { periods: daily.properties.periods } } },
    ]);

    const error = await failure(createNwsWeatherProvider({ ...options, fetch }).read());

    expect(error.reason).toBe('invalid_response');
  });

  it('rejects malformed JSON from the points endpoint', async () => {
    const { fetch } = fakeFetch([{ rawBody: '{not json' }]);

    const error = await failure(createNwsWeatherProvider({ ...options, fetch }).read());

    expect(error.reason).toBe('invalid_response');
  });

  it('rejects provider-supplied forecast URLs outside the NWS API', async () => {
    const { fetch, calls } = fakeFetch([
      {
        body: {
          properties: {
            forecast: 'https://evil.example/gridpoints/TOP/32,81/forecast',
            forecastHourly: 'https://api.weather.gov/gridpoints/TOP/32,81/forecast/hourly',
            timeZone: 'America/Chicago',
          },
        },
      },
    ]);

    const error = await failure(createNwsWeatherProvider({ ...options, fetch }).read());

    expect(error.reason).toBe('invalid_response');
    expect(calls).toHaveLength(1);
  });

  it('rejects a non-HTTPS provider-supplied forecast URL', async () => {
    const { fetch } = fakeFetch([
      {
        body: {
          properties: {
            forecast: 'http://api.weather.gov/gridpoints/TOP/32,81/forecast',
            forecastHourly: 'https://api.weather.gov/gridpoints/TOP/32,81/forecast/hourly',
            timeZone: 'America/Chicago',
          },
        },
      },
    ]);

    const error = await failure(createNwsWeatherProvider({ ...options, fetch }).read());

    expect(error.reason).toBe('invalid_response');
  });

  it('rejects an invalid provider time zone', async () => {
    const { fetch } = fakeFetch([
      { body: { properties: { ...points.properties, timeZone: 'Not/AZone' } } },
    ]);

    const error = await failure(createNwsWeatherProvider({ ...options, fetch }).read());

    expect(error.reason).toBe('invalid_response');
  });

  it('reports a network failure without exposing request details', async () => {
    const fetchImpl = (async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:443');
    }) as typeof fetch;

    const error = await failure(createNwsWeatherProvider({ ...options, fetch: fetchImpl }).read());

    expect(error.reason).toBe('network');
    expect(error.message).not.toContain('127.0.0.1');
    expect(error.message).not.toContain('ECONNREFUSED');
  });

  it('reports a non-success HTTP response as a network failure', async () => {
    const { fetch } = fakeFetch([{ status: 500, body: { detail: 'internal secret' } }]);

    const error = await failure(createNwsWeatherProvider({ ...options, fetch }).read());

    expect(error.reason).toBe('network');
    expect(error.message).not.toContain('internal secret');
  });

  it('bounds a request that does not complete', async () => {
    const { fetch } = fakeFetch([{ hang: true }]);

    const error = await failure(
      createNwsWeatherProvider({ ...options, fetch, timeoutMs: 5 }).read(),
    );

    expect(error.reason).toBe('timeout');
  });

  it('uses the location time zone to choose the current forecast day', async () => {
    const { fetch } = fakeFetch([
      { body: points },
      {
        body: {
          properties: {
            updateTime: '2026-11-02T03:26:32+00:00',
            periods: [
              { startTime: '2026-11-01T18:00:00-06:00', isDaytime: false, temperature: 58, temperatureUnit: 'F', shortForecast: 'Tonight' },
              { startTime: '2026-11-02T06:00:00-06:00', isDaytime: true, temperature: 74, temperatureUnit: 'F', shortForecast: 'Monday' },
            ],
          },
        },
      },
      { body: hourly },
    ]);

    const reading = await createNwsWeatherProvider({
      ...options,
      fetch,
      now: () => new Date('2026-11-02T04:00:00Z'),
    }).read();

    expect(reading.today).toMatchObject({ date: '2026-11-01', highF: null, lowF: 58 });
  });

  it('reports a failed daily forecast as a network failure', async () => {
    const { fetch } = fakeFetch([{ body: points }, { status: 500 }, { body: hourly }]);

    const error = await failure(createNwsWeatherProvider({ ...options, fetch }).read());

    expect(error.reason).toBe('network');
  });

  it('rejects a points response that is not an object', async () => {
    const { fetch } = fakeFetch([{ body: [] }]);

    const error = await failure(createNwsWeatherProvider({ ...options, fetch }).read());

    expect(error.reason).toBe('invalid_response');
  });

  it('leaves current conditions unavailable when the hourly temperature is missing', async () => {
    const { fetch } = fakeFetch([
      { body: points },
      { body: daily },
      {
        body: {
          properties: {
            periods: [{ startTime: '2026-11-01T07:00:00-06:00', temperature: null, temperatureUnit: 'F', shortForecast: 'Patchy Fog' }],
          },
        },
      },
    ]);

    const reading = await createNwsWeatherProvider({ ...options, fetch }).read();

    expect(reading.current).toBeNull();
    expect(reading.today.highF).toBe(66);
  });

  it('keeps current conditions available when the hourly description is missing', async () => {
    const { fetch } = fakeFetch([
      { body: points },
      { body: daily },
      {
        body: {
          properties: {
            periods: [{ startTime: '2026-11-01T07:00:00-06:00', temperature: 55, temperatureUnit: 'F' }],
          },
        },
      },
    ]);

    const reading = await createNwsWeatherProvider({ ...options, fetch }).read();

    expect(reading.current).toEqual({
      temperatureF: 55,
      description: null,
      periodStart: '2026-11-01T07:00:00-06:00',
    });
  });

  it('leaves the forecast description empty when the provider supplies no text', async () => {
    const { fetch } = fakeFetch([
      { body: points },
      {
        body: {
          properties: {
            updateTime: '2026-11-01T13:26:32+00:00',
            periods: [
              { startTime: '2026-11-01T07:00:00-06:00', isDaytime: true, temperature: 66, temperatureUnit: 'F', shortForecast: '   ' },
            ],
          },
        },
      },
      { body: hourly },
    ]);

    const reading = await createNwsWeatherProvider({ ...options, fetch }).read();

    expect(reading.today.description).toBeNull();
    expect(reading.today.highF).toBe(66);
  });

  it('uses the first usable period when the provider omits daytime data', async () => {
    const { fetch } = fakeFetch([
      { body: points },
      {
        body: {
          properties: {
            updateTime: '2026-11-01T13:26:32+00:00',
            periods: [
              { startTime: '2026-11-01T18:00:00-06:00', isDaytime: false, temperature: 58, temperatureUnit: 'F', shortForecast: 'Chance Rain Showers' },
            ],
          },
        },
      },
      { body: hourly },
    ]);

    const reading = await createNwsWeatherProvider({ ...options, fetch }).read();

    expect(reading.today).toEqual({
      date: '2026-11-01',
      highF: null,
      lowF: 58,
      description: 'Chance Rain Showers',
    });
  });

  it('disables automatic redirects and omits credentials on NWS fetches', async () => {
    const { fetch, calls } = fakeFetch([{ body: points }, { body: daily }, { body: hourly }]);

    await createNwsWeatherProvider({ ...options, fetch }).read();

    for (const call of calls) {
      expect(call.init?.redirect).toBe('manual');
      expect(call.init?.credentials).toBe('omit');
    }
  });

  it('rejects cross-origin redirects without following them and cancels the response body', async () => {
    const calls: string[] = [];
    let cancelled = false;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      const body = new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('redirect body')); },
        cancel() { cancelled = true; },
      });
      return new Response(body, { status: 302, headers: { location: 'https://evil.example/gridpoints/TOP/32,81/forecast' } });
    }) as typeof fetch;

    const error = await failure(createNwsWeatherProvider({ ...options, fetch: fetchImpl }).read());

    expect(error.reason).toBe('invalid_response');
    expect(calls).toEqual(['https://api.weather.gov/points/39.7456,-97.0892']);
    expect(cancelled).toBe(true);
  });

  it('follows bounded same-origin NWS redirects while cancelling intermediate bodies and rejecting loops', async () => {
    const calls: string[] = [];
    let redirectBodyCancelled = false;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === 'https://api.weather.gov/points/39.7456,-97.0892') {
        const body = new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode('moved')); },
          cancel() { redirectBodyCancelled = true; },
        });
        return new Response(body, { status: 301, headers: { location: '/points/39.7456,-97.0892' } });
      }
      if (url.endsWith('/forecast/hourly')) return jsonResponse({ body: hourly });
      if (url.endsWith('/forecast')) return jsonResponse({ body: daily });
      return jsonResponse({ body: points });
    }) as typeof fetch;

    const loopErr = await failure(createNwsWeatherProvider({ ...options, fetch: fetchImpl }).read());
    expect(loopErr.reason).toBe('invalid_response');
    expect(redirectBodyCancelled).toBe(true);
    expect(calls).toHaveLength(3);

    const hopCalls: string[] = [];
    let hopped = false;
    const goodRedirectFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      hopCalls.push(url);
      if (!hopped && url.includes('/points/')) {
        hopped = true;
        return new Response('moved', { status: 301, headers: { location: 'https://api.weather.gov/points/39.75,-97.09' } });
      }
      if (url.endsWith('/forecast/hourly')) return jsonResponse({ body: hourly });
      if (url.endsWith('/forecast')) return jsonResponse({ body: daily });
      return jsonResponse({ body: points });
    }) as typeof fetch;

    const reading = await createNwsWeatherProvider({ ...options, fetch: goodRedirectFetch }).read();
    expect(reading.today.highF).toBe(66);
    expect(hopCalls[0]).toBe('https://api.weather.gov/points/39.7456,-97.0892');
    expect(hopCalls[1]).toBe('https://api.weather.gov/points/39.75,-97.09');
  });

  it('cancels the response body on non-OK responses and rejects oversized JSON payloads', async () => {
    let errorCancelled = false;
    const errFetch = (async () => {
      const body = new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('server error')); },
        cancel() { errorCancelled = true; },
      });
      return new Response(body, { status: 500 });
    }) as typeof fetch;

    const netErr = await failure(createNwsWeatherProvider({ ...options, fetch: errFetch }).read());
    expect(netErr.reason).toBe('network');
    expect(errorCancelled).toBe(true);

    let streamCancelled = false;
    const hugeFetch = (async () => {
      const chunk = new Uint8Array(256 * 1024).fill(65);
      let sent = 0;
      const body = new ReadableStream({
        pull(controller) {
          if (sent < 4) {
            sent += 1;
            controller.enqueue(chunk);
          } else {
            controller.close();
          }
        },
        cancel() { streamCancelled = true; },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/geo+json' } });
    }) as typeof fetch;

    const sizeErr = await failure(createNwsWeatherProvider({ ...options, fetch: hugeFetch }).read());
    expect(sizeErr.reason).toBe('invalid_response');
    expect(streamCancelled).toBe(true);
  });

  it('selects the active hourly period for now and drops expired-only hourly feeds', async () => {
    const multiHourly = {
      properties: {
        periods: [
          { startTime: '2026-11-01T07:00:00-06:00', endTime: '2026-11-01T08:00:00-06:00', temperature: 55, temperatureUnit: 'F', shortForecast: 'Old Hour' },
          { startTime: '2026-11-01T08:00:00-06:00', endTime: '2026-11-01T09:00:00-06:00', temperature: 61, temperatureUnit: 'F', shortForecast: 'Current Hour' },
          { startTime: '2026-11-01T09:00:00-06:00', endTime: '2026-11-01T10:00:00-06:00', temperature: 67, temperatureUnit: 'F', shortForecast: 'Next Hour' },
        ],
      },
    };
    const { fetch } = fakeFetch([{ body: points }, { body: daily }, { body: multiHourly }]);
    const reading = await createNwsWeatherProvider({
      ...options,
      fetch,
      // 14:30Z is 08:30-06:00 (inside the second hourly period).
      now: () => new Date('2026-11-01T14:30:00Z'),
    }).read();

    expect(reading.current).toEqual({
      temperatureF: 61,
      description: 'Current Hour',
      periodStart: '2026-11-01T08:00:00-06:00',
    });

    const expired = fakeFetch([{ body: points }, { body: daily }, { body: multiHourly }]);
    const later = await createNwsWeatherProvider({
      ...options,
      fetch: expired.fetch,
      // 18:00Z is 12:00-06:00 (after all hourly periods have ended).
      now: () => new Date('2026-11-01T18:00:00Z'),
    }).read();

    expect(later.current).toBeNull();
  });

  it('converts UTC and non-local period startTime timestamps into the grid timeZone before matching today', async () => {
    const { fetch } = fakeFetch([
      { body: points },
      {
        body: {
          properties: {
            updateTime: '2026-11-02T01:00:00Z',
            periods: [
              // 2026-11-02T00:00:00Z is 2026-11-01 18:00 in America/Chicago (still Nov 1!).
              { startTime: '2026-11-02T00:00:00Z', isDaytime: false, temperature: 54, temperatureUnit: 'F', shortForecast: 'Clear Tonight' },
              // 2026-11-02T12:00:00Z is 2026-11-02 06:00 in America/Chicago (Nov 2).
              { startTime: '2026-11-02T12:00:00Z', isDaytime: true, temperature: 72, temperatureUnit: 'F', shortForecast: 'Sunny Monday' },
            ],
          },
        },
      },
      { body: hourly },
    ]);

    const reading = await createNwsWeatherProvider({
      ...options,
      fetch,
      // 2026-11-02T02:00:00Z is 2026-11-01 20:00 in America/Chicago.
      now: () => new Date('2026-11-02T02:00:00Z'),
    }).read();

    expect(reading.today).toEqual({
      date: '2026-11-01',
      highF: null,
      lowF: 54,
      description: 'Clear Tonight',
    });
  });
});
