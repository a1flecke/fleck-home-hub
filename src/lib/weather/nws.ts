import { WeatherProviderError } from './errors';
import { NWS_API_ORIGIN, parseCurrent, parseDaily, parsePoint } from './nws-parse';
import type { CurrentConditions, WeatherProvider, WeatherReading } from './types';

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_NWS_REDIRECTS = 2;
export const MAX_NWS_RESPONSE_BYTES = 512 * 1024;

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
        const currentNow = now();
        const daily = parseDaily(dailyResult.value, grid.timeZone, currentNow);

        let current: CurrentConditions | null = null;
        if (hourlyResult.status === 'fulfilled') {
          try {
            current = parseCurrent(hourlyResult.value, currentNow);
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

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort drain/cancel on error or redirect paths.
  }
}

function allowedNwsRedirect(location: string | null, baseUrl: string): string | null {
  if (!location) return null;
  let target: URL;
  try {
    target = new URL(location, baseUrl);
  } catch {
    return null;
  }
  if (
    target.origin !== NWS_API_ORIGIN ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    (!target.pathname.startsWith('/points/') && !target.pathname.startsWith('/gridpoints/'))
  ) {
    return null;
  }
  return target.toString();
}

async function readBoundedText(response: Response, deadline: Deadline): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_NWS_RESPONSE_BYTES) {
    await cancelBody(response);
    throw new WeatherProviderError('invalid_response');
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_NWS_RESPONSE_BYTES) {
      throw new WeatherProviderError('invalid_response');
    }
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_NWS_RESPONSE_BYTES) {
        await reader.cancel();
        throw new WeatherProviderError('invalid_response');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (error instanceof WeatherProviderError) throw error;
    throw new WeatherProviderError(deadline.timedOut() ? 'timeout' : 'invalid_response');
  }
}

async function readJson(
  url: string,
  deadline: Deadline,
  fetchImpl: typeof fetch,
  userAgent: string,
): Promise<unknown> {
  let currentUrl = url;
  for (let hop = 0; hop <= MAX_NWS_REDIRECTS; hop += 1) {
    let response: Response;
    try {
      response = await fetchImpl(currentUrl, {
        headers: { 'User-Agent': userAgent, Accept: 'application/geo+json' },
        signal: deadline.signal,
        redirect: 'manual',
        credentials: 'omit',
      });
    } catch {
      throw new WeatherProviderError(deadline.timedOut() ? 'timeout' : 'network');
    }

    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      const nextUrl = allowedNwsRedirect(response.headers.get('location'), currentUrl);
      await cancelBody(response);
      if (!nextUrl || hop === MAX_NWS_REDIRECTS) {
        throw new WeatherProviderError('invalid_response');
      }
      currentUrl = nextUrl;
      continue;
    }

    if (!response.ok) {
      await cancelBody(response);
      throw new WeatherProviderError('network');
    }

    const raw = await readBoundedText(response, deadline);
    try {
      return JSON.parse(raw);
    } catch {
      throw new WeatherProviderError(deadline.timedOut() ? 'timeout' : 'invalid_response');
    }
  }
  throw new WeatherProviderError('invalid_response');
}
