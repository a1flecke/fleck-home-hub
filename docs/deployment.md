# macOS hosting and recovery

This is the runbook for hosting the hub on an always-on Mac. The tooling below is covered by synthetic automated tests, and parts were exercised locally on an Apple-silicon Mac (see [Verification status](#verification-status)). **launchd start-at-login, crash restart, reboot, sleep/wake, Tailscale Serve, iPhone and display behaviour have not been validated end to end.** Do not use real household data until the pilot test plan results (added in the follow-up recovery PR) are recorded and independently reviewed.

## Supported hosts

The toolchain is pinned by `mise.toml` and `mise.lock`, and the lock lists **`macos-arm64` and `linux-x64` only**. An Apple-silicon Mac is the supported host. An Intel Mac (`macos-x64`) has no locked Node or pnpm binaries, so `MISE_LOCKED_SCOPES=project mise install --locked` cannot provide the pinned toolchain there; the preflight reports FAIL. Do not bypass the lock with unlocked tools. Supporting Intel would need a reviewed `mise lock` change that adds the platform and its checksums.

## 1. Preflight (read-only)

```bash
mise run pilot-preflight -- --config-file "$HOME/.config/fleck-home-hub/hub.conf" --backup-dir /private/path/backups
```

It checks the OS/architecture against the lock, mise-installed binaries, dependencies, the build and its build-time origin, the private configuration file, the database path and permissions, loopback binding and existing listeners on the port, free space and the backup directory. Each line is `PASS` (verified locally), `WARN` (operator must validate), `FAIL` (unsafe or missing) or `UNKNOWN` (cannot be determined safely). Exit status is 1 if any `FAIL`; `--strict` also exits 2 on `WARN`/`UNKNOWN`. It never prints `AUTH_SECRET`, never runs `launchctl` or `tailscale`, and writes nothing (`mise where` may touch mise's own state directory). Tailscale being installed does **not** show that the tailnet, ACLs or Serve are configured safely, and the preflight says so.

Pass flags after `--` (`--config-file`, not `--env-file`: Node itself intercepts `--env-file` anywhere on the command line and would load the file with its own rules).

## 2. Private configuration file

Create a directory outside the repository (for example `~/.config/fleck-home-hub`, mode 700) holding `hub.conf` with mode 600, owned by the service user:

```
AUTH_SECRET=<unique random value, at least 32 characters>
DATABASE_PATH=/absolute/private/path/hub.sqlite
AUTH_ORIGIN=https://<machine>.<tailnet>.ts.net
# optional, loopback only:
# HOST=127.0.0.1
# PORT=3000
```

The launcher reads this file as **data**: only the five keys above, one `KEY=VALUE` per line, optional surrounding quotes, no expansion or command substitution, no duplicates. Anything else is refused. Generate the secret yourself without echoing it (for example `openssl rand -hex 32`, redirected straight into the file), and never paste it into GitHub, chat or shell arguments. `DATABASE_PATH` must be absolute, outside the repository, in a mode-700 directory, and must not exist before the first bootstrap.

`AUTH_ORIGIN` must be the exact HTTPS origin the browsers use. It is also a **build-time** input (`paths.origin`), so export it when building and rebuild whenever it changes.

## 3. Provision, build, start locally

1. `./scripts/bootstrap.sh`, then build with the origin: `AUTH_ORIGIN=https://… mise run build`. The preflight's `build-origin` check compares the build with `AUTH_ORIGIN`.
2. Create the first parent and household once from a private JSON file (`name`, `email`, `password`, `household`): `mise run bootstrap-account < /private/path/account.json`, with the three settings exported into that shell without leaving values in history. It exclusively creates a new database and refuses to overwrite one. Remove the input file securely afterwards. A failed setup may leave an incomplete file: inspect and keep it as evidence before retrying.
3. Further people: a parent opens `/settings/household`, creates a seven-day single-use invitation for a role and shares the link privately; a parent can disable a member there (existing sessions stop working, last-parent protection applies); each person ends their own sessions at `/settings/sessions`; displays are paired and revoked at `/settings/displays`. `mise run add-kid` remains available for local provisioning. See [household access](household-access.md) and [display](display.md). Public signup is disabled.
4. `mise run start` runs `scripts/start.sh` (`HOST` defaults to `127.0.0.1`, port 3000 unless `PORT` is set).

Note that the application validates `AUTH_SECRET`/`AUTH_ORIGIN`/`DATABASE_PATH` lazily, on the first authentication request, not at process start. A listening process with bad configuration still answers `/` while sign-in returns 503. The launcher validates up front for that reason, and the health check below distinguishes it.

## 4. Health diagnostics

```bash
mise run pilot-health -- --config-file "$HOME/.config/fleck-home-hub/hub.conf"
```

It makes two unauthenticated `GET` requests to the loopback listener (`/` and Better Auth's public `/api/auth/ok`) and opens the configured database read-only for `quick_check`. It adds no route to the application, sends no cookies or credentials, and prints no database path, account data, secret, migration detail or stack trace. The existing `curl /` only proves HTTP reachability.

| State (exit) | Meaning | First action |
| --- | --- | --- |
| `HEALTHY` (0) | HTTP, authentication runtime and database all responded locally. | None. This is not proof of private HTTPS or device access. |
| `NOT_LISTENING` (2) | Connection refused on the loopback address. | Service stopped or crashed: see logs, `status`, restart. |
| `RUNTIME_UNAVAILABLE` (3) | Port open but no valid HTTP response, a 5xx, or identity reports unavailable while config and database look fine. | Inspect `stderr.log`; restart. |
| `DATABASE_UNAVAILABLE` (4) | Configured database missing, unopenable or failing `quick_check`. | Do not delete anything. Preserve files, then follow restore guidance. |
| `CONFIG_INVALID` (5) | Required settings absent/invalid, or a non-loopback `HOST`. | Run the preflight; fix the private file; restart. |
| `HTTPS_PROBE_FAILED` (6) | Only with `--probe-https`: the local service is healthy but the HTTPS origin failed from this Mac. | Investigate Tailscale Serve, DNS and certificates manually. |

`--probe-https` succeeding proves only that the Mac can reach its own Serve URL, not that a phone can.

## 5. launchd (LaunchAgent)

The template is a **per-user LaunchAgent** (label `local.fleck.home-hub`). A LaunchAgent runs inside the service user's GUI login session, so after a reboot the app starts **only once that user has logged in**; the pilot plan must decide whether the household accepts this or enables automatic login (a security trade-off this repository does not change for you). A **LaunchDaemon** starts at boot as a system job (usually as root unless `UserName` is set), needs root-owned files and installation under `/Library/LaunchDaemons`, and would put private data access and a network service under a broader privilege model. It is deliberately not provided; it needs its own review.

`scripts/pilot/launchd.mjs` generates the plist and wraps the few `launchctl` verbs. **Everything is a dry run unless `--apply` is passed.**

```bash
mise run pilot-launchd -- preview --config-file "$HOME/.config/fleck-home-hub/hub.conf"   # prints the plist
mise run pilot-launchd -- install --config-file "$HOME/.config/fleck-home-hub/hub.conf"   # dry run: prints the plan
```

Review the plist, then (only on the intended host, after the preflight has no `FAIL`) opt in:

```bash
mise run pilot-launchd -- install --apply --config-file "$HOME/.config/fleck-home-hub/hub.conf"
mise run pilot-launchd -- status --apply     # launchctl print
mise run pilot-launchd -- restart --apply    # launchctl kickstart -k
mise run pilot-launchd -- uninstall --apply  # launchctl bootout, then removes only that plist
```

What the template does: `ProgramArguments` is only `scripts/pilot/launch.sh`; `WorkingDirectory` is the repository; the environment carries only paths (`HUB_ENV_FILE`, `HUB_MISE`, `HUB_LOG_DIR`, `PATH`), **never credentials**. The launcher unsets any inherited `AUTH_*`, `ORIGIN`, `HOST`, `SOCKET_PATH` and proxy-header variables, loads the private file, refuses a non-loopback `HOST`, a bad origin or a short secret (exit 78), then `exec`s `scripts/start.sh` with the pinned mise. `RunAtLoad` is on; `KeepAlive` is `SuccessfulExit=false`, so a crash or non-zero exit restarts after a 30-second `ThrottleInterval`, while a deliberate clean exit does not. A configuration error therefore retries every 30 seconds until fixed, logging a message without values. Umask is 077.

**Logs** go to `~/Library/Logs/fleck-home-hub/stdout.log` and `stderr.log` (directory mode 700). launchd does not rotate them; the launcher copy-truncates a file larger than 5 MiB (`HUB_LOG_MAX_BYTES`) to `*.log.1` at each (re)start. A long-running process is therefore bounded only across restarts; check the size occasionally. Logs must not be shared without review.

Nothing here changes sleep settings. A sleeping Mac cannot serve requests: configure sleep for the household yourself and test it. The automated tests render and validate the plist and run the launcher against stubs; they never call `launchctl`. `plutil -lint` on the rendered file passed on one Mac, but loading the agent, restart after a crash, login and reboot behaviour remain to be tested (to be covered by the pilot test plan in the follow-up PR).

## 6. Private remote access

Mac service on loopback → Tailscale Serve HTTPS → authenticated browsers. Never Funnel, never router port forwarding. Review the official [Serve documentation](https://tailscale.com/docs/reference/tailscale-cli/serve) and inspect existing Serve configuration before enabling anything; use the resulting HTTPS URL as `AUTH_ORIGIN` and rebuild. Tailnet membership does not replace application authorization. A read-only validation checklist follows in the next PR.

## 7. Backup, restore and update

`mise run backup /private/path/new-backup.sqlite` makes an online SQLite backup with owner-only permissions, refuses an existing destination and integrity-checks the result. Restore only into a **new** location, never over the active database; rehearse it (a synthetic rehearsal procedure follows in the next PR), keeping in mind the warning that an older snapshot restores previously valid sessions, invitations and paired-display credentials.

To update: create and verify a fresh backup, stop the service, install locked tools and frozen dependencies, run `mise run migrate` on the existing database, rebuild with the correct origin, start, run the health check. Auth and household migrations commit separately, so a later failure can leave the auth migration applied; on failure stop, preserve evidence, and restore a verified backup into a new path. To roll back code, restore the previous commit and its matching build together with a database from before the migration.

## Verification status

| Status | Evidence or remaining work |
| --- | --- |
| Verified automatically (Linux-compatible, synthetic) | Preflight, launcher, plist generation, launchd dry-run/apply logic with an injected runner, health states and recovery, secret non-disclosure, backup and failed-migration recovery. `mise run test`, `mise run recovery-test`. |
| Verified locally on one Apple-silicon Mac, by hand, with synthetic data | The preflight and health scripts against the real production build started through the real launcher (not through launchd); `plutil -lint` of the generated plist; crash of that process reported as `NOT_LISTENING`. |
| Verified on the actual household Mac, phone or display | **None recorded.** |
| Not yet verified | `launchctl` load/restart, login and reboot behaviour, sleep/wake, Tailscale Serve and ACLs, secure cookies over the real origin, iPhone Safari and standalone, display hardware, host-specific restore and encrypted off-host backup. |
