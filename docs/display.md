# Shared display

The display requires a normal household member session. Parents choose events and today's chores to share on the separate settings page, and can share meals when creating or editing them. Sharing an event applies to its entire series; sharing a chore applies only to that occurrence. A parent can remove either selection, including after the record leaves the display's date range. Records are private by default. The display sends selected event and chore titles, dates, times and chore statuses, as well as selected meal ingredients, source, recipe link and any saved eMeals recipe details; it excludes private meal notes, event and chore descriptions, locations, assignee names, balances and rewards. A recognized eMeals link shows **Recipe source: eMeals** and **Open original recipe on eMeals** together. Recipe details show only yield, total time and named ingredient groups; directions and images are never imported. Unsharing a meal removes its full card, ingredients, recipe details and recipe URL from the display response and from child meal responses. Skipped and paused unstarted recurring chores are hidden.

When `WEATHER_LATITUDE` and `WEATHER_LONGITUDE` are configured, the display also shows a weather card from the server-side National Weather Service provider: the near-term hourly forecast temperature, today's high and low when available, a short description, and the provider update time. The temperature is a forecast, not a live station observation. A snapshot past the fresh window is labeled as an older forecast with its retrieval time, and every available card credits NOAA / National Weather Service. Missing measurements are omitted, and a real `0°F` remains visible. If weather is unconfigured, times out, returns an unusable response or is otherwise unavailable, the card says so and the rest of the display continues normally. Weather uses one process-wide service with a 10-minute fresh cache, a 60-minute stale limit, background refresh with retries, and a circuit breaker; the 60-second page refresh does not cause an NWS request every minute. Aging weather is returned immediately while a background refresh runs. See [weather.md](weather.md).

With JavaScript, the page refreshes its data every 60 seconds; automatic updates can be paused. A refresh link works without JavaScript. There is no offline cache; a failed background refresh displays a connection message, while a failed manual reload uses the browser's network error.

## Two ways to view

- **Signed-in household member** (unchanged): an ordinary account opens `/display`. Expired or revoked sessions must sign in again. That account keeps its ordinary privileges, so do not leave it signed in on an unattended screen.
- **Paired display** (restricted): a parent creates a one-time pairing code and the display redeems it at `/display/pair`. The display then holds only a revocable display credential in an HttpOnly cookie scoped to `/display`. It sees exactly the shared information above, with no navigation or management controls, and cannot reach any other page or action. Credentials expire after 90 days. Revoked, expired or orphaned credentials return the display to a **Pairing required** screen. A device that is signed in as a person must sign out before it can be paired. See [ADR 0004](adr/0004-restricted-display-sessions.md) for the invariants and threat model.

### Pairing a display

1. On a parent's own device, open **Household displays** (`/settings/displays`, linked from the sharing page), name the display (for example "Kitchen screen") and choose **Create pairing code**. The code is shown once and is not stored; up to five unused codes may exist per household.
2. On the display, make sure no personal account is signed in (pairing refuses a device with a normal session and offers sign-out), open `/display/pair` and type the code. Enter it through a private channel; do not put it in chat, tickets or screenshots, and it never belongs in a URL.
3. The code works once and expires after 10 minutes. The display receives a credential valid for 90 days and opens the read-only view. There is no automatic renewal: after expiry, or after any revocation, a parent pairs again.

The management page lists each display's name, status (active, expired or revoked), when it was paired and when it was last seen (updated at most every five minutes), and lets any parent in the household revoke it or cancel an unused code. Raw credentials are never displayed. Revocation applies on the display's next server request; with the 60-second refresh the display shows **Pairing required** within about a minute, and a reload cannot restore it.

### What a paired display can and cannot show

It can show shared event and chore titles, dates, times and chore status, shared meals with their permitted ingredients and recipe details, the weather card, and the date and time zone. It cannot open or act on any other page, and receives no notes, descriptions, locations, assignees, balances, rewards, payouts, members, invitations, pairing codes or session information. Each of those is enforced by the server, not by hiding links.

### Disabled parents, lost displays and limits

- Disabling the parent who paired a display revokes their unused codes and every display they paired at once; other parents' displays and other households are unaffected. The household shows those displays as revoked.
- To recover from a lost or stolen display, open **Household displays** and revoke it. Then pair a replacement. Revocation stops future server responses; whatever the screen already rendered, or a copy of the browser profile's cookie before revocation, cannot be erased remotely.
- An unlocked display still shows its shared information to anyone who can see it. Reaching the host over Tailscale is not authorization: a code is still required to pair, and a credential to read.
- If the Mac is offline, the display cannot refresh, shows its connection message and keeps the last rendered content. Once the Mac returns, revoked displays go to Pairing required.
- Serve over HTTPS so the cookie is marked Secure (`AUTH_ORIGIN` must be `https://`; plain HTTP is accepted only for localhost). All `/display*` and `/settings/displays` responses are `no-store`.

Pairing and kiosk behavior is validated by automated browser tests with synthetic data only. It has **not** been checked on a real display, iPhone, tablet, or over the real tailnet; see the pilot checklist in [deployment](deployment.md).

Migration `0005_display` creates opt-in tables without altering existing records; `0012_display_pairing` adds the pairing and display-credential tables (forward-only, no existing data changes). Stop the service and verify a backup before upgrading. Actual device, tailnet and unattended-use behavior remain unverified. Calendar daylight-saving limitations in [calendar.md](calendar.md) still apply.
