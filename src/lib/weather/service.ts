import {
  WeatherProviderError,
  type WeatherUnavailableReason,
} from './errors';
import type {
  WeatherProvider,
  WeatherResult,
  WeatherSnapshot,
} from './types';

export const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1_000;
export const DEFAULT_MAX_STALE_MS = 60 * 60 * 1_000;

const UNAVAILABLE_MESSAGES: Record<WeatherUnavailableReason, string> = {
  timeout: 'Weather data timed out.',
  network: 'Weather data is temporarily unavailable.',
  invalid_response: 'Weather data was not usable.',
};

export type WeatherServiceOptions = {
  provider: WeatherProvider;
  now?: () => Date;
  cacheTtlMs?: number;
  maxStaleMs?: number;
};

export interface WeatherService {
  getCurrent(): Promise<WeatherResult>;
}

type CacheEntry = {
  snapshot: WeatherSnapshot;
  cachedAtMs: number;
};

export function createWeatherService(options: WeatherServiceOptions): WeatherService {
  const now = options.now ?? (() => new Date());
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const maxStaleMs = options.maxStaleMs ?? DEFAULT_MAX_STALE_MS;
  let cache: CacheEntry | null = null;

  return {
    async getCurrent(): Promise<WeatherResult> {
      if (cache && now().getTime() - cache.cachedAtMs < cacheTtlMs) {
        return { ok: true, weather: { ...cache.snapshot } };
      }

      try {
        const reading = await options.provider.read();
        const fetchedAt = now();
        const snapshot: WeatherSnapshot = { ...reading, fetchedAt: fetchedAt.toISOString(), stale: false };
        cache = { snapshot, cachedAtMs: fetchedAt.getTime() };
        return { ok: true, weather: { ...snapshot } };
      } catch (error) {
        const reason = error instanceof WeatherProviderError ? error.reason : 'network';
        if (cache && now().getTime() - cache.cachedAtMs <= maxStaleMs) {
          return { ok: true, weather: { ...cache.snapshot, stale: true } };
        }
        return { ok: false, reason, message: UNAVAILABLE_MESSAGES[reason] };
      }
    },
  };
}
