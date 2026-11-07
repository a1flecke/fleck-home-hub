# macOS hosting and recovery

This runbook is for manual setup; macOS startup, sleep/wake, Tailscale Serve, remote phone access and iOS installation have **not** been validated end to end. Do not use real household data until those tests and the security review pass.

1. Install mise, review the repository, then run `./scripts/bootstrap.sh`. Keep the source, build and private data on a filesystem available to the service user. Create a private directory outside the repository for the database, configuration and backups; restrict access to the service user.
2. Provide `DATABASE_PATH` (an absolute path that does not yet exist), `AUTH_SECRET` (a unique random secret of at least 32 characters) and `AUTH_ORIGIN` (the exact HTTPS Tailscale Serve origin, or `http://127.0.0.1:3000` for local-only development). Store these in a user-owned file readable only by the service user; do not commit or paste the secret into GitHub. Export them into the current shell without placing values in shell history.
3. Put the initial account fields `name`, `email`, `password` and `household` in a private JSON input file. Run `mise run bootstrap-account < /private/path/account.json` from the repository root. The command exclusively creates a new database; it refuses to overwrite an existing file and prints the household ID. Protect the input file and remove it securely according to your local policy after provisioning. A failed initial setup may leave an incomplete new file: inspect it and preserve evidence before retrying.
4. After bootstrap and sign-in, a parent can open `/settings/household`, select Parent or Child, create an invitation, and copy the link to the intended person using a trusted private channel. The recipient opens the link and chooses their own password. Links work once, expire after seven days, and can be revoked while pending. Existing accounts cannot be linked. Alternatively, the local `mise run add-kid` command accepts a private JSON input file with `name`, `email`, `password`, and `householdId`. Public signup remains disabled. Member disabling and session management are not yet available; see [security](security.md).
5. With the public `AUTH_ORIGIN` set during the build, run `mise run build` and `mise run start`. The production wrapper defaults to `HOST=127.0.0.1` and port 3000; an explicit `HOST` or `SOCKET_PATH` changes the listener. SvelteKit 3 uses `paths.origin` at build time for its trusted self-origin, so rebuild when the origin changes. Check `curl -f http://127.0.0.1:3000/` and inspect the listener before exposing it. This probe checks the page, not database health.

For private remote access, review the [Tailscale Serve documentation](https://tailscale.com/docs/reference/tailscale-cli/serve) and manually run `tailscale serve --bg 3000` on the host after confirming existing Serve configuration. Use the resulting HTTPS URL as `AUTH_ORIGIN`; do not use Funnel or router port forwarding. Confirm a phone on the tailnet can open the HTTPS URL from a non-home network, sign in, sign out, and receive correct parent/kid authorization. Check cookies and cross-site request handling. On iPhone Safari, use Share → Add to Home Screen and test the standalone launch; the current SVG icon and installation behavior remain unverified on iOS. Tailnet membership does not replace app authorization.

## Starting after login and sleep

For a user LaunchAgent, create a user-owned launcher script that changes to the repository, loads the private environment, and executes the absolute path to mise with `run start`. Keep that script and its environment file private. Create a `~/Library/LaunchAgents` plist whose `ProgramArguments` invokes that launcher, with `RunAtLoad` and `KeepAlive`, and configure protected log paths. Manually load it with `launchctl bootstrap gui/$(id -u) /path/to/the.plist`; use `launchctl print` to inspect and `launchctl bootout` to stop. The agent starts in the user's login session, not necessarily before login; test after reboot and after an intentional crash. Do not put the secret directly in the plist or logs.

A sleeping Mac cannot serve requests reliably. Configure sleep/wake to suit the household, then test sleep, wake, reboot, network changes and service restart. Review launchd logs and HTTP health after each. Do not change sleep settings automatically.

## Backup, restore and update

With environment configured, run `mise run backup /private/path/new-backup.sqlite`. The online SQLite backup is created with owner-only permissions, refuses an existing destination and runs an integrity check. Store encrypted copies off the host, control access, and practice restoration. Automated synthetic tests cover backup and restoration, including accounts, verified earnings, payouts, a correction, a rejected schema change, migrations and SQLite integrity. `mise run recovery-test` also builds an isolated production copy, restores a separate database after a failed migration, checks the adapter's reported localhost listener, and verifies parent and child sign-in and recovered ledger totals through the running application. It does not prove recovery on the real host.

To restore, stop the application, preserve the current database and its WAL/SHM files, copy a known-good backup to a **new** private location, set `DATABASE_PATH` to that copy, and start only after checking SQLite integrity. Verify login, membership and representative records, then retain the original until recovery is confirmed. Never overwrite the only copy. To update, create and verify a fresh backup, install locked tools and frozen dependencies, run `mise run migrate` on the existing database while the app is stopped, build with the correct origin, and restart. On a failed migration, stop and inspect the failure; restore a verified backup if needed. Auth and household migrations commit separately, so a later failure can leave the auth migration applied. Better Auth upgrades require a reviewed, version-controlled schema migration and upgrade tests before use on real data.

## Display pairing pilot checklist

Backups include the pairing and display-credential tables (hashes only), so a restore also restores which displays were revoked: after restoring an older backup, re-check **Household displays** and revoke anything that should not be active. Pairing requires `AUTH_ORIGIN` to be the exact HTTPS origin the display uses; its Secure cookie is not sent over HTTP. None of the following has been performed on real hardware; a separately authorized pilot should record each result:

- Pair the actual display device over the tailnet using a private channel for the code; confirm it works after sleep, wake and reboot of both the display and the Mac.
- Confirm the browser keeps the cookie (private browsing and "clear on quit" settings can drop it) and that kiosk or home-screen mode launches `/display` without a personal sign-in.
- Revoke the display from a parent's phone and time how long it takes the screen to show Pairing required; confirm it never regains access on reload.
- Disable a test parent who paired a display and confirm the display is revoked.
- Disconnect the Mac and confirm the screen shows its connection message rather than stale-looking success.
- Confirm Tailscale access controls and that tailnet reachability alone does not show household data.

## Pilot verification status

| Status | Evidence or remaining work |
| --- | --- |
| Verified automatically | Synthetic backup, failed-migration recovery, production startup on the reported loopback address, both roles' sign-in and recovered ledger totals; run `mise run recovery-test` and `mise run test`. |
| Verified on the actual Mac or phone | None recorded. |
| Not yet verified | Host-specific restore and encrypted off-host backup; launchd start, crash restart and login/reboot; sleep/wake; Tailscale Serve, tailnet access controls and device revocation; iPhone Safari and standalone installation; real-device session and household workflows. |
