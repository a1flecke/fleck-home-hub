import {
  createNwsWeatherProvider,
  createWeatherService,
  readWeatherConfig,
  type WeatherResult,
  type WeatherService,
} from '../weather';

export const DEFAULT_REFRESH_INTERVAL_MS = 60_000;

export type DisplayWeather =
  | {
      status: 'available';
      timeZone: string;
      temperatureF: number | null;
      description: string | null;
      highF: number | null;
      lowF: number | null;
      fresh: boolean;
      stale: boolean;
      fetchedAt: string;
      forecastUpdatedAt: string;
      retrievedAtLabel: string;
      forecastUpdatedLabel: string;
    }
  | { status: 'unavailable' };

export type DisplayWeatherSource = {
  get: () => Promise<DisplayWeather>;
  stop: () => void;
};

export type DisplayWeatherSourceOptions = {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => Date;
  cacheTtlMs?: number;
  maxStaleMs?: number;
  retryDelaysMs?: readonly number[];
  retryCooldownMs?: number;
  backgroundRefresh?: boolean;
  refreshIntervalMs?: number;
};

const unavailable = (): DisplayWeather => ({ status: 'unavailable' });

export function createDisplayWeatherSource(options: DisplayWeatherSourceOptions): DisplayWeatherSource {
  let service: WeatherService | null = null;
  try {
    const config = readWeatherConfig(options.env);
    service = createWeatherService({
      provider: createNwsWeatherProvider({
        latitude: config.latitude,
        longitude: config.longitude,
        userAgent: config.userAgent,
        timeoutMs: config.timeoutMs,
        fetch: options.fetch,
        now: options.now,
      }),
      now: options.now,
      cacheTtlMs: options.cacheTtlMs,
      maxStaleMs: options.maxStaleMs,
      retryDelaysMs: options.retryDelaysMs,
      retryCooldownMs: options.retryCooldownMs,
    });
  } catch {
    service = null;
  }

  const backgroundRefresh = options.backgroundRefresh !== false;
  const refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule(): void {
    if (!started || !service) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!started || !service) return;
      void service.backgroundTick().catch(() => null).finally(() => {
        schedule();
      });
    }, refreshIntervalMs);
    timer.unref();
  }

  function start(): void {
    if (started || !service || !backgroundRefresh) return;
    started = true;
    schedule();
  }

  function stop(): void {
    started = false;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  async function get(): Promise<DisplayWeather> {
    if (!service) return unavailable();
    start();
    try {
      return toDisplayWeather(await service.getCurrent());
    } catch {
      return unavailable();
    }
  }

  return { get, stop };
}

function toDisplayWeather(result: WeatherResult): DisplayWeather {
  if (!result.ok) return unavailable();
  const { weather } = result;
  return {
    status: 'available',
    timeZone: weather.timeZone,
    temperatureF: weather.current?.temperatureF ?? null,
    description: weather.current?.description ?? weather.today.description ?? null,
    highF: weather.today.highF,
    lowF: weather.today.lowF,
    fresh: weather.fresh,
    stale: weather.stale,
    fetchedAt: weather.fetchedAt,
    forecastUpdatedAt: weather.forecastUpdatedAt,
    retrievedAtLabel: formatTimestamp(weather.fetchedAt, weather.timeZone),
    forecastUpdatedLabel: formatTimestamp(weather.forecastUpdatedAt, weather.timeZone),
  };
}

function formatTimestamp(value: string, timeZone: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  } catch {
    return '';
  }
}

let defaultSource: DisplayWeatherSource | undefined;

export function getDisplayWeather(): Promise<DisplayWeather> {
  defaultSource ??= createDisplayWeatherSource({ env: process.env });
  return defaultSource.get();
}

const hot = (import.meta as ImportMeta & { hot?: { dispose: (callback: () => void) => void } }).hot;
hot?.dispose(() => {
  defaultSource?.stop();
  defaultSource = undefined;
});
