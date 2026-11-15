# ADR 0005 — Host-authorized family onboarding

Status: accepted for implementation. Real-device and tailnet validation use the pilot plan. Tracking issue: [#86](https://github.com/a1flecke/fleck-home-hub/issues/86).

## First parent

An explicit host-operator action creates the private database if needed, runs reviewed migrations, and issues a 30-minute random code through the controlling terminal. SQLite stores the SHA-256 digest. Issuing a replacement invalidates the older code. The browser submits the code in a password field over the exact configured origin. The route never echoes the code or the parent's password.

Better Auth owns initial credential creation, password hashing and the session cookie. The account signup worker locks the SQLite writer and rechecks the code, its expiry, and absence of households and accounts before Better Auth creates anything. Household, time zone, parent membership, onboarding state, code consumption, account and session either all commit or all roll back on that connection. Global signup is closed. The host code is the only authority for browser setup. Restoring a backup from before initial provisioning restores its old database state, so the operator must treat that as an unconfigured installation and issue a fresh code.

## Household progress

Only newly created browser households have an onboarding row. Active parents can advance, go back or finish. The writer lock and current-step check protect against stale tabs and simultaneous updates. The dashboard is always available after the first account exists. Parents resume the saved step through the dashboard. Starter activities deep-link to the existing pages and preserve progress.

## Child identity

A managed child has an ordinary Better Auth account and a kid membership. When sign-in is deferred, a secret random password is generated and discarded and no username is registered. A parent can assign a case-insensitive username and password at any time. Better Auth's existing SQLite schema requires an email-shaped storage value. For managed children it is an opaque randomly generated value under the reserved `children.fleck.invalid` domain. It never appears in family settings and cannot be used at the public email sign-in endpoint. The child sign-in adapter resolves the username on the server and calls the same Better Auth email/password handler and rate limit; it forwards only session cookies to the browser. Managed accounts use the app’s account controls, which keep password changes under parent authority and omit raw tokens from session listings.

A reset writes the new Better Auth hash and a credential version and revokes existing sessions in one writer transaction. The child sign-in adapter checks that the credential version and membership still match after password verification, before returning any cookie. New managed identities belong to one household. Existing email-based child accounts and parent accounts keep their current sign-in flow. Password hashes and the worker's pinned adapter APIs must be rechecked on Better Auth upgrades.

## Deployment boundary

Tailscale Serve provides private HTTPS reachability. Neither tailnet membership, forwarded headers nor loopback determines who may claim setup. Protect the host, its private database and operator terminal. A person who intercepts a live setup code before it is used can claim the new installation. Reissuing a code closes that window for the earlier one. Follow the [deployment runbook](../deployment.md) and the [Tailscale Serve reference](https://tailscale.com/docs/reference/tailscale-cli/serve).
