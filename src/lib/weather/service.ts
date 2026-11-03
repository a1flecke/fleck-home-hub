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
export const DEFAULT_RETRY_DELAYS_MS = [500, 2_000] as const;
export const DEFAULT_RETRY_JITTER = 0.25;
export const DEFAULT_FAILURE_THRESHOLD = 3;
export const DEFAULT_BREAKER_COOLDOWN_MS = 15 * 60 * 1_000;
export const DEFAULT_MAX_BREAKER_COOLDOWN_MS = 60 * 60 * 1_000;
export const DEFAULT_RETRY_COOLDOWN_MS = 60 * 1_000;

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
  retryDelaysMs?: readonly number[];
  retryJitter?: number;
  failureThreshold?: number;
  breakerCooldownMs?: number;
  maxBreakerCooldownMs?: number;
  retryCooldownMs?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type WeatherRefreshOptions = {
  retries?: boolean;
};

export interface WeatherService {
  getCurrent(): Promise<WeatherResult>;
  refresh(options?: WeatherRefreshOptions): Promise<WeatherResult>;
  backgroundTick(): Promise<WeatherResult | null>;
}

type BreakerState = 'closed' | 'open' | 'half-open';

export function createWeatherService(options: WeatherServiceOptions): WeatherService {
  const now = options.now ?? (() => new Date());
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const maxStaleMs = options.maxStaleMs ?? DEFAULT_MAX_STALE_MS;
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const retryJitter = options.retryJitter ?? DEFAULT_RETRY_JITTER;
  const failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
  const breakerCooldownMs = options.breakerCooldownMs ?? DEFAULT_BREAKER_COOLDOWN_MS;
  const maxBreakerCooldownMs = options.maxBreakerCooldownMs ?? DEFAULT_MAX_BREAKER_COOLDOWN_MS;
  const retryCooldownMs = options.retryCooldownMs ?? DEFAULT_RETRY_COOLDOWN_MS;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let snapshot: WeatherSnapshot | null = null;
  let fetchedAtMs = 0;
  let lastFailed = false;
  let lastReason: WeatherUnavailableReason | undefined;
  let failures = 0;
  let breaker: BreakerState = 'closed';
  let openUntilMs = 0;
  let breakerCooldown = breakerCooldownMs;
  let nextRetryAtMs = 0;
  let refreshing: Promise<WeatherResult> | null = null;

  function failure(reason: WeatherUnavailableReason = lastReason ?? 'network'): WeatherResult {
    return { ok: false, reason, message: UNAVAILABLE_MESSAGES[reason] };
  }

  function resultFromSnapshot(nowMs: number): WeatherResult {
    if (!snapshot) return failure();
    const ageMs = nowMs - fetchedAtMs;
    if (ageMs > maxStaleMs) return failure();
    return {
      ok: true,
      weather: {
        ...snapshot,
        fresh: ageMs < cacheTtlMs && !lastFailed,
        stale: lastFailed,
      },
    };
  }

  function canAttempt(nowMs: number): boolean {
    if (refreshing) return false;
    if (breaker === 'open' && nowMs < openUntilMs) return false;
    if (nowMs < nextRetryAtMs) return false;
    return true;
  }

  function triggerBackgroundRefresh(nowMs: number): void {
    if (!canAttempt(nowMs)) return;
    void refresh({ retries: true }).catch(() => null);
  }

  function delayWithJitter(baseMs: number): number {
    const factor = 1 - retryJitter + random() * retryJitter * 2;
    return Math.max(0, Math.round(baseMs * factor));
  }

  async function runRefresh(retries: boolean): Promise<WeatherResult> {
    const delays = retries ? retryDelaysMs : [];
    let reason: WeatherUnavailableReason = 'network';

    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      if (attempt > 0) await sleep(delayWithJitter(delays[attempt - 1]));
      try {
        const reading = await options.provider.read();
        const fetchedAt = now();
        fetchedAtMs = fetchedAt.getTime();
        snapshot = { ...reading, fetchedAt: fetchedAt.toISOString(), fresh: true, stale: false };
        lastFailed = false;
        lastReason = undefined;
        failures = 0;
        breaker = 'closed';
        breakerCooldown = breakerCooldownMs;
        openUntilMs = 0;
        nextRetryAtMs = 0;
        return { ok: true, weather: { ...snapshot } };
      } catch (error) {
        reason = error instanceof WeatherProviderError ? error.reason : 'network';
        if (reason === 'invalid_response' || attempt === delays.length) break;
      }
    }

    lastFailed = true;
    lastReason = reason;
    failures += 1;
    const failedAtMs = now().getTime();
    nextRetryAtMs = failedAtMs + retryCooldownMs;
    if (breaker === 'half-open') {
      breakerCooldown = Math.min(breakerCooldown * 2, maxBreakerCooldownMs);
      breaker = 'open';
      openUntilMs = failedAtMs + breakerCooldown;
    } else if (failures >= failureThreshold) {
      breaker = 'open';
      openUntilMs = failedAtMs + breakerCooldown;
    }

    if (snapshot && failedAtMs - fetchedAtMs <= maxStaleMs) {
      return { ok: true, weather: { ...snapshot, fresh: false, stale: true } };
    }
    return failure(reason);
  }

  function refresh(refreshOptions: WeatherRefreshOptions = {}): Promise<WeatherResult> {
    if (refreshing) return refreshing;
    const nowMs = now().getTime();
    if (breaker === 'open') {
      if (nowMs < openUntilMs) return Promise.resolve(failure());
      breaker = 'half-open';
    }
    const retries = refreshOptions.retries === true && breaker === 'closed';
    refreshing = runRefresh(retries)
      .catch(() => failure('network'))
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  async function getCurrent(): Promise<WeatherResult> {
    const nowMs = now().getTime();
    if (snapshot) {
      if (nowMs - fetchedAtMs <= maxStaleMs) {
        if (nowMs - fetchedAtMs >= cacheTtlMs) triggerBackgroundRefresh(nowMs);
        return resultFromSnapshot(nowMs);
      }
      triggerBackgroundRefresh(nowMs);
      return failure();
    }
    if (breaker === 'open' && nowMs < openUntilMs) return failure();
    if (nowMs < nextRetryAtMs) return failure();
    return refresh({ retries: false });
  }

  async function backgroundTick(): Promise<WeatherResult | null> {
    const nowMs = now().getTime();
    if (snapshot && nowMs - fetchedAtMs < cacheTtlMs) return null;
    if (!canAttempt(nowMs)) return null;
    return refresh({ retries: snapshot !== null });
  }

  return { getCurrent, refresh, backgroundTick };
}
