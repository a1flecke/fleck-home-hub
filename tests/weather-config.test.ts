import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEATHER_TIMEOUT_MS,
  DEFAULT_WEATHER_USER_AGENT,
  readWeatherConfig,
} from '../src/lib/weather';

const valid = { WEATHER_LATITUDE: '39.7456', WEATHER_LONGITUDE: '-97.0892' };

describe('weather configuration', () => {
  it('reads a configurable location without requiring a personal address', () => {
    expect(readWeatherConfig(valid)).toEqual({
      latitude: 39.7456,
      longitude: -97.0892,
      userAgent: DEFAULT_WEATHER_USER_AGENT,
      timeoutMs: DEFAULT_WEATHER_TIMEOUT_MS,
    });
  });

  it('requires both coordinates explicitly', () => {
    expect(() => readWeatherConfig({})).toThrow('WEATHER_LATITUDE and WEATHER_LONGITUDE are required');
    expect(() => readWeatherConfig({ WEATHER_LATITUDE: '39.7456' })).toThrow();
    expect(() => readWeatherConfig({ WEATHER_LONGITUDE: '-97.0892' })).toThrow();
    expect(() => readWeatherConfig({ WEATHER_LATITUDE: '  ', WEATHER_LONGITUDE: '-97.0892' })).toThrow();
  });

  it('rejects non-numeric and out-of-range coordinates', () => {
    expect(() => readWeatherConfig({ ...valid, WEATHER_LATITUDE: 'north' })).toThrow();
    expect(() => readWeatherConfig({ ...valid, WEATHER_LATITUDE: '91' })).toThrow();
    expect(() => readWeatherConfig({ ...valid, WEATHER_LATITUDE: '-90.1' })).toThrow();
    expect(() => readWeatherConfig({ ...valid, WEATHER_LONGITUDE: '181' })).toThrow();
    expect(() => readWeatherConfig({ ...valid, WEATHER_LONGITUDE: '-180.1' })).toThrow();
    expect(() => readWeatherConfig({ ...valid, WEATHER_LATITUDE: 'Infinity' })).toThrow();
  });

  it('accepts the coordinate boundaries and trims surrounding space', () => {
    expect(readWeatherConfig({ WEATHER_LATITUDE: ' 90 ', WEATHER_LONGITUDE: '180' })).toMatchObject({
      latitude: 90,
      longitude: 180,
    });
    expect(readWeatherConfig({ WEATHER_LATITUDE: '-90', WEATHER_LONGITUDE: '-180' })).toMatchObject({
      latitude: -90,
      longitude: -180,
    });
  });

  it('accepts an explicit User-Agent and timeout', () => {
    expect(
      readWeatherConfig({
        ...valid,
        WEATHER_USER_AGENT: 'home-hub (https://example.test/contact)',
        WEATHER_TIMEOUT_MS: '2500',
      }),
    ).toMatchObject({
      userAgent: 'home-hub (https://example.test/contact)',
      timeoutMs: 2500,
    });
  });

  it('rejects a User-Agent that could inject a header or is unusable', () => {
    expect(() => readWeatherConfig({ ...valid, WEATHER_USER_AGENT: 'home-hub\r\nX-Injected: yes' })).toThrow();
    expect(() => readWeatherConfig({ ...valid, WEATHER_USER_AGENT: 'home-hub\nX-Injected: yes' })).toThrow();
    expect(() => readWeatherConfig({ ...valid, WEATHER_USER_AGENT: '   ' })).toThrow();
    expect(() => readWeatherConfig({ ...valid, WEATHER_USER_AGENT: 'x'.repeat(201) })).toThrow();
  });

  it('keeps the network timeout inside an explicit bounded range', () => {
    expect(() => readWeatherConfig({ ...valid, WEATHER_TIMEOUT_MS: '99' })).toThrow();
    expect(() => readWeatherConfig({ ...valid, WEATHER_TIMEOUT_MS: '15001' })).toThrow();
    expect(() => readWeatherConfig({ ...valid, WEATHER_TIMEOUT_MS: '1.5' })).toThrow();
    expect(() => readWeatherConfig({ ...valid, WEATHER_TIMEOUT_MS: 'soon' })).toThrow();
    expect(readWeatherConfig({ ...valid, WEATHER_TIMEOUT_MS: '100' }).timeoutMs).toBe(100);
    expect(readWeatherConfig({ ...valid, WEATHER_TIMEOUT_MS: '15000' }).timeoutMs).toBe(15000);
  });
});
