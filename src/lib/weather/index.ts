export {
  DEFAULT_WEATHER_TIMEOUT_MS,
  DEFAULT_WEATHER_USER_AGENT,
  readWeatherConfig,
  type WeatherConfig,
} from './config';
export {
  WeatherProviderError,
  type WeatherProviderFailureReason,
  type WeatherUnavailableReason,
} from './errors';
export {
  createNwsWeatherProvider,
  type NwsWeatherProviderOptions,
} from './nws';
export {
  DEFAULT_BREAKER_COOLDOWN_MS,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_MAX_BREAKER_COOLDOWN_MS,
  DEFAULT_MAX_STALE_MS,
  DEFAULT_RETRY_COOLDOWN_MS,
  DEFAULT_RETRY_DELAYS_MS,
  DEFAULT_RETRY_JITTER,
  createWeatherService,
  type WeatherRefreshOptions,
  type WeatherService,
  type WeatherServiceOptions,
} from './service';
export type {
  CurrentConditions,
  DailyForecast,
  WeatherFailure,
  WeatherProvider,
  WeatherReading,
  WeatherResult,
  WeatherSnapshot,
  WeatherSuccess,
} from './types';
