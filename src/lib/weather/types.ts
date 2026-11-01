import type { WeatherUnavailableReason } from './errors';

export type CurrentConditions = {
  temperatureF: number;
  description: string | null;
  periodStart: string;
};

export type DailyForecast = {
  date: string;
  highF: number | null;
  lowF: number | null;
  description: string | null;
};

export type WeatherReading = {
  timeZone: string;
  forecastUpdatedAt: string;
  current: CurrentConditions | null;
  today: DailyForecast;
};

export type WeatherSnapshot = WeatherReading & {
  fetchedAt: string;
  stale: boolean;
};

export type WeatherSuccess = {
  ok: true;
  weather: WeatherSnapshot;
};

export type WeatherFailure = {
  ok: false;
  reason: WeatherUnavailableReason;
  message: string;
};

export type WeatherResult = WeatherSuccess | WeatherFailure;

export interface WeatherProvider {
  read(): Promise<WeatherReading>;
}
