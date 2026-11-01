import { WeatherProviderError } from './errors';
import { NWS_API_ORIGIN, parseCurrent, parseDaily, parsePoint } from './nws-parse';
import type { CurrentConditions, WeatherProvider, WeatherReading } from './types';

const DEFAULT_TIMEOUT_MS = 5_000;

export type NwsWeatherProviderOptions = {
  latitude: number;
  longitude: number;
  userAgent: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => Date;
};

export function createNwsWeatherProvider(options: NwsWeatherProviderOptions): WeatherProvider {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async read(): Promise<WeatherReading> {
      const deadline = createDeadline(timeoutMs);
      try {
        const pointUrl = `${NWS_API_ORIGIN}/points/${options.latitude},${options.longitude}`;
        const point = await readJson(pointUrl, deadline, fetchImpl, options.userAgent);
        const grid = parsePoint(point);
        const [dailyResult, hourlyResult] = await Promise.allSettled([
          readJson(grid.forecastUrl, deadline, fetchImpl, options.userAgent),
          readJson(grid.hourlyUrl, deadline, fetchImpl, options.userAgent),
        ]);

        if (dailyResult.status === 'rejected') throw dailyResult.reason;
        const daily = parseDaily(dailyResult.value, grid.timeZone, now());

        let current: CurrentConditions | null = null;
        if (hourlyResult.status === 'fulfilled') {
          try {
            current = parseCurrent(hourlyResult.value);
          } catch {
            current = null;
          }
        }

        return {
          timeZone: grid.timeZone,
          forecastUpdatedAt: daily.forecastUpdatedAt,
          current,
          today: daily.today,
        };
      } catch (error) {
        if (error instanceof WeatherProviderError) throw error;
        throw new WeatherProviderError('invalid_response');
      } finally {
        deadline.clear();
      }
    },
  };
}

type Deadline = {
  signal: AbortSignal;
  timedOut: () => boolean;
  clear: () => void;
};

function createDeadline(timeoutMs: number): Deadline {
  const controller = new AbortController();
  let didTimeOut = false;
  const timer = setTimeout(() => {
    didTimeOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    clear: () => clearTimeout(timer),
  };
}

async function readJson(
  url: string,
  deadline: Deadline,
  fetchImpl: typeof fetch,
  userAgent: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { 'User-Agent': userAgent, Accept: 'application/geo+json' },
      signal: deadline.signal,
    });
  } catch {
    throw new WeatherProviderError(deadline.timedOut() ? 'timeout' : 'network');
  }

  if (!response.ok) throw new WeatherProviderError('network');

  try {
    return await response.json();
  } catch {
    throw new WeatherProviderError(deadline.timedOut() ? 'timeout' : 'invalid_response');
  }
}
