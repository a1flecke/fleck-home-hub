# ADR 0002: Weather refresh reliability

Status: accepted.

- **In-process only:** one long-lived Node process owns the weather service, in-memory snapshot, background loop and circuit breaker. There is no cross-process cache, persistent cache or cross-process refresh lease. A multi-process deployment would run one loop per process and could duplicate provider requests; those controls remain future work.
- **Serve cache, refresh behind it:** a snapshot younger than 10 minutes is fresh. A snapshot between 10 and 60 minutes is returned immediately with `fresh: false` while one background refresh runs. An empty cache waits for one bounded provider attempt. A snapshot older than 60 minutes is unavailable.
- **Single-flight:** at most one provider refresh runs at a time; concurrent display reads share it.
- **Retries:** background refreshes with a snapshot make up to three attempts for `timeout` and `network` failures, with 500 ms then 2 s backoff and ±25% jitter. `invalid_response` is not retried. Cold reads and half-open probes make one attempt. A failed cycle sets a 60-second cooldown.
- **Circuit breaker:** three consecutive failed refresh cycles open the breaker for 15 minutes. While open, reads serve the last snapshot if it is within the stale window, or report unavailable, without contacting the provider. After the cooldown one half-open probe is allowed; success closes and resets the breaker, while failure reopens it and doubles the cooldown up to 60 minutes.
- **Background loop:** the server integration starts a lazy 60-second maintenance loop on the first display weather read. A tick refreshes only when the snapshot is aging, the retry cooldown has elapsed, and the breaker permits a call. The timer is `unref`ed and stops when the module is disposed or the source is stopped.
- **Freshness:** `fresh` describes age plus the latest refresh outcome, while `stale` describes a failed refresh cycle. Aging data is therefore `fresh: false, stale: false` and is still labeled as an older forecast.

Consequences: display loads do not wait for retries when a snapshot exists, NWS requests are bounded during an outage, and recovery can take up to the breaker cooldown. Restarting the process discards the snapshot. The actual household display, home Mac and iPhone remain manually unverified.
