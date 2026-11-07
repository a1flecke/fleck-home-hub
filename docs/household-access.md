# Household access and revocation

Two separate things grant access, and revoking one does not revoke the other:

- **Authentication** is a Better Auth session. It is global to the account and carries no household.
- **Household membership** is a row in `membership`. A valid session authorizes nothing by itself; every household read and write checks membership on the server.

## Disabled membership (PR B1)

A parent can disable one member of one household. The row stays, with `disabled_at` and `disabled_by`; the global user, the person's other households, chores, earnings, payouts, transitions and audit actors are untouched. `chore`, `earning` and `payout` foreign-key to `membership`, which is why a member is never deleted.

- **One authorization source.** The `active_membership` view (`disabled_at IS NULL`) is what every service, route and the invitation worker read. Only `src/lib/server/household-access.ts` names `membership` directly, pinned by `tests/architecture/membership-access.test.ts` (with a negative fixture). A new reader that forgets the filter fails that test.
- **Policy.** A parent may disable another member of the same household, never themselves. The actor is re-checked as an active parent inside an immediate (writer-locked) transaction, so two parents disabling each other serialize and the second is refused. Two triggers repeat the invariants in the database: a household cannot lose its last active parent, and a member cannot be disabled by themselves or by nobody.
- **Idempotent.** Repeating a disable succeeds with "already disabled" and never rewrites the original actor or time.
- **No re-enable, no role change.** The application has no path to re-enable, and an invitation never links or revives an existing account. Restoring access needs an operator with database access. This is deliberate for the first version; a re-enable flow would need its own review.
- **Invitations.** Disabling a member revokes the links they issued in the same transaction. Redemption also requires the issuer to be an active parent, so a link cannot be redeemed even if the revocation were bypassed.
- **Multiple households.** Disabling affects one household. A person with another active membership keeps it; `primaryActiveMembership` then resolves to that household (existing behavior picks the lowest household id).
- **History.** Ledger and chore rows are not modified. A disabled child's pending chores stay visible to parents by record; they cannot be assigned new work, and a payout to a disabled child is refused in this version (balance stays recorded). Follow-up if that proves a problem.

## Threat model

| Scenario | Outcome |
|---|---|
| Stolen authenticated session | Not addressed here: the session stays valid until sign-out/expiry. Disabling the member closes the household; session controls are PR B2. |
| Parent revokes a child | Child's session stays valid but every household route and service returns 403 (reads and mutations), proven with real sessions. |
| Parent revokes another parent | Same; the former parent cannot invite, approve, pay out or open settings. |
| Last parent | Refused in the service and by a database trigger. |
| Concurrent removal by two parents | Writer-locked transaction re-checks the actor; exactly one succeeds. |
| Invitations from a disabled issuer | Revoked on disable; redemption rejects a disabled issuer. |
| Disabled user accepting an invitation | A new invitation cannot link the existing account (duplicate email fails and rolls back). |
| Cross-household access | Membership is checked per household id; other households are unaffected. |
| Session revocation across households | Not touched by this PR; sessions are global (B2 will state this explicitly). |
| Historical chores and money | Unchanged; asserted by snapshotting `chore`, `chore_transition`, `earning` and `payout` before and after. |

## Known limits

- Authorization is checked per request against the database; there is no cache to invalidate.
- Pre-existing: routes with several households pick the first by id rather than a user-selected one.
- Browser tests were run against the dev server; real-device and tailnet behavior remain unverified.

## Session management (PR B2)

`/settings/sessions` (linked from the home page, any signed-in role) wraps the pinned Better Auth 1.7.14 session API: `listSessions`, `revokeSession` and `revokeOtherSessions`. No custom cookies or Better Auth internals are involved.

- **Scope is the caller's own account.** Sessions are global to an account and carry no household. A parent cannot list or end another person's sessions, and ending a session never changes membership. Both directions are tested: membership denial leaves the session valid, and signing a device out leaves membership untouched.
- **Cross-household effect is stated on the page.** Signing a device out ends it for every household the account belongs to.
- **No raw tokens.** The page and responses carry only the session row id; the server maps an id to a token inside `src/lib/server/sessions.ts` and only for sessions that `listSessions` returned for the caller. An unknown, foreign or already-ended id changes nothing.
- **Actions.** End one other session, or end all other sessions (the current one stays). Each is a native POST behind a confirmation disclosure, with the origin check used elsewhere.
- **Freshness.** Better Auth lists sessions only for a recently created session (its freshness window, one day by default). An older session sees a "sign in again" screen instead of a list; this is framework behavior, not custom code.

### Limits

- A parent **cannot end a disabled or other member's sessions**: the pinned framework exposes no administrator session API, and enabling the admin plugin is a separate, larger decision. Disabling membership blocks the household without it; the person's session remains valid for their other households, as intended.
- There is no "sign out everywhere including this device" action; use sign out after ending the others. There is no automatic revocation on password change because there is no password-change flow yet.
- Device labels come from the User-Agent header and are only a hint. IP addresses are not shown because forwarded headers are not trusted.

### Displays and disabling

Disabling a parent also revokes the pairing codes they created and every display they paired, in the same transaction; other parents' displays are unaffected. A display is not a member and has no role. See [display](display.md) and [ADR 0004](adr/0004-restricted-display-sessions.md).
