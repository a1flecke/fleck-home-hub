export const DEFAULT_WEATHER_TIMEOUT_MS = 5_000;
export const DEFAULT_WEATHER_USER_AGENT = 'fleck-home-hub (https://github.com/a1flecke/fleck-home-hub)';

const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 15_000;
const MAX_USER_AGENT_LENGTH = 200;

export type WeatherConfig = {
  latitude: number;
  longitude: number;
  userAgent: string;
  timeoutMs: number;
};

export function readWeatherConfig(env: Record<string, string | undefined>): WeatherConfig {
  const latitude = readCoordinate(env.WEATHER_LATITUDE, 'WEATHER_LATITUDE', 90);
  const longitude = readCoordinate(env.WEATHER_LONGITUDE, 'WEATHER_LONGITUDE', 180);
  const userAgent = readUserAgent(env.WEATHER_USER_AGENT);
  const timeoutMs = readTimeout(env.WEATHER_TIMEOUT_MS);
  return { latitude, longitude, userAgent, timeoutMs };
}

function readCoordinate(raw: string | undefined, name: string, limit: number): number {
  const value = raw?.trim();
  if (!value) throw new Error('WEATHER_LATITUDE and WEATHER_LONGITUDE are required');
  const coordinate = Number(value);
  if (!Number.isFinite(coordinate) || coordinate < -limit || coordinate > limit) {
    throw new Error(`${name} must be a number between ${-limit} and ${limit}`);
  }
  return coordinate;
}

function readUserAgent(raw: string | undefined): string {
  if (raw === undefined) return DEFAULT_WEATHER_USER_AGENT;
  const userAgent = raw.trim();
  if (!userAgent || userAgent.length > MAX_USER_AGENT_LENGTH || hasControlCharacter(userAgent)) {
    throw new Error(`WEATHER_USER_AGENT must be a single line of at most ${MAX_USER_AGENT_LENGTH} characters`);
  }
  return userAgent;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

function readTimeout(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_WEATHER_TIMEOUT_MS;
  const timeoutMs = Number(raw.trim());
  if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`WEATHER_TIMEOUT_MS must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`);
  }
  return timeoutMs;
}
