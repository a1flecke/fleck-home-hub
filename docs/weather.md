# Weather

The weather module is a read-only, server-side provider. The authenticated family display reads it through a process-wide server integration. It exposes current conditions, the current forecast day's high and low, a short forecast description, provider and retrieval timestamps, and explicit freshness state.

## Provider

The only implemented provider is the [National Weather Service API](https://www.weather.gov/documentation/services-web-api) at `https://api.weather.gov`. It is an official U.S. Government service for U.S. locations and territories; it is not a global provider.

### Terms, attribution and access

- NWS describes the API data as open data, free to use for any purpose, with no API key. Review the current [API documentation](https://www.weather.gov/documentation/services-web-api) and [NWS disclaimer](https://www.weather.gov/disclaimer) before relying on it.
- Every request identifies the application with a `User-Agent` header. NWS recommends including a website or contact address so it can reach the operator about a security event. The default identifies this project; set `WEATHER_USER_AGENT` to a more specific value if desired.
- NWS does not publish its rate limit. It describes the limit as generous for typical use and says a limited request may be retried after roughly five seconds. This module caches successful responses to reduce requests, but it does not implement retry or backoff.
- NWS provides no uptime guarantee. Operational issues are reported through NWS channels (the API documentation lists `nco.ops@noaa.gov`). The service degrades to stale or unavailable data instead of failing the page.
- The family display credits NWS data as “Weather data from NOAA / National Weather Service” with a link to `https://www.weather.gov/`.

### Response formats used

The provider makes three GET requests per refresh:

1. `GET /points/{latitude},{longitude}` returns the forecast grid URLs, the location's time zone and other metadata as GeoJSON.
2. `GET /gridpoints/{office}/{x},{y}/forecast` returns 12-hour forecast periods for about seven days.
3. `GET /gridpoints/{office}/{x},{y}/forecast/hourly` returns hourly forecast periods for about seven days.

Requests ask for `application/geo+json`; responses are JSON-LD/GeoJSON objects. Times are ISO 8601 strings with an offset. The daily forecast's `properties.updateTime` is exposed as `forecastUpdatedAt`.

The provider trusts only HTTPS grid URLs under `https://api.weather.gov` that it receives from the `/points` response. A different origin, a non-HTTPS URL, credentials in the URL, or a query or fragment makes the response unusable. This prevents a malformed or compromised provider response from turning the adapter into an arbitrary URL fetcher.

## Configuration

Configuration comes from private environment variables. Do not commit a household address or private coordinates.

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `WEATHER_LATITUDE` | yes | — | Latitude from -90 to 90 |
| `WEATHER_LONGITUDE` | yes | — | Longitude from -180 to 180 |
| `WEATHER_USER_AGENT` | no | project identifier | Single-line value of at most 200 characters |
| `WEATHER_TIMEOUT_MS` | no | `5000` | Total network deadline from 100 to 15000 ms |

The following values are a synthetic example from the NWS documentation, not a household location:

```sh
WEATHER_LATITUDE=39.7456
WEATHER_LONGITUDE=-97.0892
WEATHER_USER_AGENT='fleck-home-hub (https://github.com/a1flecke/fleck-home-hub)'
```

`readWeatherConfig` rejects missing or non-numeric coordinates, out-of-range values, a blank or multi-line `User-Agent`, and a timeout outside the supported range. The error messages name the variable, not its value.

## Service behavior

```ts
type WeatherSnapshot = {
  timeZone: string;
  forecastUpdatedAt: string; // provider issue time, normalized to ISO
  fetchedAt: string;         // when this process retrieved the snapshot
  stale: boolean;            // true only when a failed refresh served cached data
  current: {
    temperatureF: number;
    description: string | null;
    periodStart: string;
  } | null;
  today: {
    date: string;            // local calendar date of the forecast day
    highF: number | null;
    lowF: number | null;
    description: string | null;
  };
};
```

Missing or invalid measurements are `null`. A real `0 °F` stays `0` and is never used as a missing-value sentinel.

“Current conditions” are the first hourly forecast period from the same NWS grid, not a station observation. They are near-term forecast values. If the hourly request fails or is malformed, the daily forecast still succeeds and `current` is `null`.

`today` is the provider's current forecast day in the location's time zone. The high comes from that day's daytime period and the low from its nighttime period. After the daytime period leaves the forecast, the high may be `null`; after sunset, the selected forecast day can still be the overnight period that began today. A daily forecast with no usable periods or no update timestamp is reported as `invalid_response` rather than as a valid forecast.

Every successful retrieval returns a snapshot. One in-memory snapshot is kept per service instance:

- For 10 minutes after retrieval, the snapshot is served without another provider request.
- After 10 minutes, the service attempts a refresh.
- If the refresh fails and the snapshot is no more than 60 minutes old, the previous snapshot is returned with `stale: true` and its original `fetchedAt`.
- If the snapshot is older than 60 minutes, or no snapshot exists, the result is unavailable.

The cache is in process memory only. It is lost on restart, is not shared between processes, and is not persisted to SQLite. Create one service instance per server process; creating one per request would defeat the cache.

Failures return a fixed, safe message and a reason:

| Reason | Message |
| --- | --- |
| `timeout` | Weather data timed out. |
| `network` | Weather data is temporarily unavailable. |
| `invalid_response` | Weather data was not usable. |

Provider bodies, request URLs, coordinates and underlying exception text are not exposed.

## Family display integration

`src/lib/server/display-weather.ts` is the server-only boundary between the provider and the authenticated family display. It reads `process.env`, creates the NWS provider and weather service lazily, and keeps that one service instance for the life of the server process. Page loads and `/display/data` refreshes share its in-memory cache. Do not create a service per request.

`loadDisplay` authenticates the household member before requesting weather. It then runs the household projection and weather read together and returns a safe projection:

```ts
type DisplayWeather =
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
```

The projection excludes coordinates, provider URLs, request details and underlying exception messages. A configuration error, provider failure or unexpected exception resolves to `status: 'unavailable'`; it never prevents events, chores, meals or the rest of the display from rendering. Concurrent display loads share one in-flight provider read, so a refresh burst does not multiply NWS requests.

The display refreshes its household projection every 60 seconds and includes weather in the same response. The weather service still serves a snapshot without a provider request for 10 minutes, attempts a refresh after that, and may serve a snapshot up to 60 minutes old as stale. A 60-second display refresh therefore does not imply an NWS request every minute.

The weather card shows the near-term hourly forecast temperature, today's high and low when present, the short forecast description, and the provider update time. The temperature is labeled **Near-term hourly forecast**, not a live observation. Missing measurements are omitted rather than replaced. A stale snapshot is labeled **Older forecast** with its retrieval time. Every available card credits **NOAA / National Weather Service** and links to `https://www.weather.gov/`.

Failure behavior covered by the display integration:

1. Missing or invalid coordinates render an unavailable card without a provider request.
2. A provider timeout, network failure or invalid response renders the neutral fallback.
3. A missing hourly temperature still shows the daily forecast.
4. A missing high or low displays only the measurement that exists.
5. A real `0 °F` displays as `0°F`.
6. Stale data is identified as older and includes its retrieval time.
7. A recovered provider replaces stale data on a later refresh.
8. A thrown or misbehaving weather integration cannot break the household projection.

Everyone who can open the authenticated display can see the weather card. Weather is public information, but it does not make the surrounding household response public.

## Tests and limitations

All automated tests inject HTTP and a clock; they never contact NWS or use private coordinates. Synthetic fixtures cover successful responses, Celsius-to-Fahrenheit conversion, zero versus missing temperatures, malformed JSON, wrong shapes, empty forecasts, unsafe provider URLs, non-success responses, network errors, timeouts, cache freshness, stale fallback, stale expiry, recovery, configuration validation, concurrent display reads and display composition. Browser tests keep weather unconfigured so they make no live request; they exercise the unavailable fallback and render synthetic refreshed payloads at landscape and phone widths. Provider response shapes were also checked against the live API during development on 2026-11-01; that check is not part of the test suite.

The weather card has not been manually verified on the actual household display, home Mac or iPhone. Browser screenshots establish responsive rendering in the test environment only.

Known limitations:

- U.S. locations only.
- Current conditions are forecast values, not measured station observations.
- There is no background refresh, retry policy, circuit breaker, cross-process cache or persistent cache.
- Weather alerts and severe-weather safety guidance are not implemented.
- The dashboard does not show weather; only the authenticated family display does.
