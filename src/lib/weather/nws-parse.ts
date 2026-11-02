import { WeatherProviderError } from './errors';
import type { CurrentConditions, DailyForecast } from './types';

export const NWS_API_ORIGIN = 'https://api.weather.gov';

export type Grid = {
  forecastUrl: string;
  hourlyUrl: string;
  timeZone: string;
};

type ParsedPeriod = {
  date: string;
  isDaytime: boolean;
  temperatureF: number | null;
  description: string | null;
};

export function parsePoint(value: unknown): Grid {
  const properties = asRecord(asRecord(value)?.properties);
  return {
    forecastUrl: readGridUrl(properties?.forecast),
    hourlyUrl: readGridUrl(properties?.forecastHourly),
    timeZone: readTimeZone(properties?.timeZone),
  };
}

export function parseDaily(
  value: unknown,
  timeZone: string,
  now: Date,
): { forecastUpdatedAt: string; today: DailyForecast } {
  const properties = asRecord(asRecord(value)?.properties);
  const forecastUpdatedAt = normalizeTimestamp(properties?.updateTime);
  const periods = properties?.periods;
  if (!Array.isArray(periods) || periods.length === 0) throw invalidResponse();

  const parsed = periods
    .map((period) => parsePeriod(period))
    .filter((period): period is ParsedPeriod => period !== null);
  if (parsed.length === 0) throw invalidResponse();

  const todayDate = localDate(now, timeZone);
  const todayPeriods = parsed.filter((period) => period.date === todayDate);
  const selected = todayPeriods.length > 0
    ? todayPeriods
    : parsed.filter((period) => period.date === parsed[0].date);
  const daytime = selected.find((period) => period.isDaytime);
  const nighttime = selected.find((period) => !period.isDaytime);

  return {
    forecastUpdatedAt,
    today: {
      date: selected[0].date,
      highF: daytime?.temperatureF ?? null,
      lowF: nighttime?.temperatureF ?? null,
      description: daytime?.description ?? selected[0].description,
    },
  };
}

export function parseCurrent(value: unknown): CurrentConditions {
  const properties = asRecord(asRecord(value)?.properties);
  const periods = properties?.periods;
  if (!Array.isArray(periods) || periods.length === 0) throw invalidResponse();
  const period = asRecord(periods[0]);
  if (!period) throw invalidResponse();
  const startTime = readPeriodStart(period.startTime);
  const temperatureF = readTemperature(period);
  if (!startTime || temperatureF === null) throw invalidResponse();
  return {
    temperatureF,
    description: readDescription(period.shortForecast),
    periodStart: startTime.value,
  };
}

export function invalidResponse(): WeatherProviderError {
  return new WeatherProviderError('invalid_response');
}

function readGridUrl(value: unknown): string {
  if (typeof value !== 'string') throw invalidResponse();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidResponse();
  }
  if (
    url.origin !== NWS_API_ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith('/gridpoints/')
  ) {
    throw invalidResponse();
  }
  return url.toString();
}

function readTimeZone(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw invalidResponse();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    throw invalidResponse();
  }
  return value;
}

function parsePeriod(value: unknown): ParsedPeriod | null {
  const period = asRecord(value);
  if (!period || typeof period.isDaytime !== 'boolean') return null;
  const startTime = readPeriodStart(period.startTime);
  if (!startTime) return null;
  return {
    date: startTime.date,
    isDaytime: period.isDaytime,
    temperatureF: readTemperature(period),
    description: readDescription(period.shortForecast),
  };
}

function readPeriodStart(value: unknown): { value: string; date: string } | null {
  if (typeof value !== 'string') return null;
  const date = /^(\d{4}-\d{2}-\d{2})T/.exec(value)?.[1];
  if (!date || !Number.isFinite(Date.parse(value))) return null;
  return { value, date };
}

function readTemperature(period: Record<string, unknown>): number | null {
  const temperature = period.temperature;
  if (typeof temperature !== 'number' || !Number.isFinite(temperature)) return null;
  if (period.temperatureUnit === 'F') return temperature;
  if (period.temperatureUnit === 'C') return Math.round((temperature * 9) / 5 + 32);
  return null;
}

function readDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const description = value.trim();
  return description.length > 0 ? description : null;
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw invalidResponse();
  return new Date(value).toISOString();
}

function localDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
