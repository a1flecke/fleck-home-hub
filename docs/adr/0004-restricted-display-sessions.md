# ADR 0004: Restricted display sessions

Status: accepted for review (backend). Independent security review is required before production use.

## Context

The family display previously required an ordinary Better Auth session, so a screen left on a kitchen counter held a person's full household privileges. A display needs a strictly smaller credential.

## Decision

A **display** is not a household member. It has no Better Auth account, no `membership` row and no role. A parent authorizes it with a one-time pairing code; redeeming the code yields a separate opaque credential that exactly one code path (`verifyDisplayCredential`) accepts, and that code path can only produce the read-only display projection.

### Trust boundary and invariants

1. A display credential is never accepted as a member credential. Better Auth never sees it; the cookie is scoped to `/display`, and `tests/display-session.integration.test.ts` presents it under every cookie name to `getSession`, `authorizeRequest` and `parentAction`.
2. A pairing code or display credential is a random value (120 and 256 bits). Only its SHA-256 digest is stored. Plaintext exists in the parent's response (code, shown once) and the display's cookie (credential).
3. A pairing code works once. Consumption and credential creation occur in one `BEGIN IMMEDIATE` transaction; `display_device.pairing_id` is UNIQUE as a structural backstop.
4. Pairing codes expire after 10 minutes. Credentials expire after 90 days with no sliding renewal; a parent pairs again.
5. Authority derives from the pairing parent. A credential is valid only while its creator is an **active parent** of the same household, checked on every request. Disabling that parent revokes their pending codes and displays in the same transaction (`disableMember`). Other parents' and other households' displays are untouched.
6. Every request re-reads the database, so revocation, expiry and disabling take effect on the next request. Nothing about authority is cached in the cookie.
7. The projection (`displayDataForDevice`) takes the household id only from a verified credential and returns only parent-shared event and chore titles/times/status and shared meals, never notes, descriptions, locations, assignees, rewards, balances, members, invitations or sessions. The unchecked readers it uses are architecture-tested to be callable only from `display.ts`, `calendar.ts` and `meals.ts`.
8. A device holding an ordinary signed-in session cannot be paired: redemption is refused until the person signs out. A member session always takes precedence over a display cookie on `/display`, so a display cookie can never add or remove privilege.
9. Failure is generic. Every invalid, expired, revoked, consumed or malformed code yields one message; the submitted code is never echoed.

### Threats considered

| Threat | Handling |
| --- | --- |
| Child or visitor using the display | The display has no write endpoints and no navigation; the credential reaches no other route. Physical access still shows whatever is on screen. |
| Stolen or copied credential | Parent revocation works on the next request; 90-day expiry; cookie is HttpOnly and not readable by page scripts. A thief with the browser profile can use it until revoked. |
| Intercepted unused code | 10-minute expiry, single use, revocable pending codes; a code intercepted and used first wins, which the parent sees as a display they did not pair. Transfer the code privately. |
| Code replay or guessing | Consumed codes fail; 120-bit codes; process-wide failure throttle (10 failures/minute) on the only unauthenticated endpoint. |
| Cross-origin forced pairing or revoke | Origin must equal `AUTH_ORIGIN` on every mutation; cookie is SameSite=Strict. |
| Concurrent redeem/revoke | Immediate transactions; a revoke that commits first makes the redeem fail, and the reverse leaves a revoked device. |
| Disabled parent | See invariant 5. |
| Stale content after revoke | All `/display*` responses are `no-store`; the page refresh switches to a pairing-required state. Content already rendered on an offline or compromised device cannot be erased remotely. |
| Tailnet access alone | Reaching the host is not authorization; a code or sign-in is required. |

Not addressed: device-bound credentials, per-device IP binding, distributed rate limiting, and any validation on real hardware.
