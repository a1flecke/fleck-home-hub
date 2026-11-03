import {
  createNwsWeatherProvider,
  createWeatherService,
  readWeatherConfig,
  type WeatherResult,
  type WeatherService,
} from '../weather';

export type DisplayWeather =
  | {
      status: 'available';
      timeZone: string;
      temperatureF: number | null;
      description: string | null;
      highF: number | null;
      lowF: number | null;
      stale: boolean;
      fetchedAt: string;
      forecastUpdatedAt: string;
      retrievedAtLabel: string;
      forecastUpdatedLabel: string;
    }
  | { status: 'unavailable' };

export type DisplayWeatherSource = {
  get: () => Promise<DisplayWeather>;
};

export type DisplayWeatherSourceOptions = {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => Date;
  cacheTtlMs?: number;
  maxStaleMs?: number;
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
    });
  } catch {
    service = null;
  }

  let inFlight: Promise<DisplayWeather> | undefined;

  return {
    async get(): Promise<DisplayWeather> {
      if (!service) return unavailable();
      if (!inFlight) {
        inFlight = service.getCurrent()
          .then(toDisplayWeather)
          .catch(() => unavailable())
          .finally(() => {
            inFlight = undefined;
          });
      }
      return inFlight;
    },
  };
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
