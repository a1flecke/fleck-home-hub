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
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_MAX_STALE_MS,
  createWeatherService,
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
