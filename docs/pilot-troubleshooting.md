# Pilot troubleshooting

Start with `mise run pilot-health -- --config-file <hub.conf>`; it names the failing layer. Never paste secrets, cookies, pairing codes or database contents into issues or chat.

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| `NOT_LISTENING` | Service stopped, crashed, or refused to start | `mise run pilot-launchd -- status --apply`; read `~/Library/Logs/fleck-home-hub/stderr.log`; `restart --apply` |
| Log says "refusing to start" | Launcher found bad config (exit 78); it retries every 30 s | Run the preflight with `--config-file`; fix the file (mode 600, allowed keys only, loopback `HOST`, 32+ character secret, HTTPS `AUTH_ORIGIN`) |
| `CONFIG_INVALID` | The config you passed is incomplete, or `HOST` is not loopback | Same as above; the running service may be using a different file |
| `DATABASE_UNAVAILABLE` | Missing, moved, locked or corrupt database | Do not delete or "repair" it. Preserve the file and its `-wal`/`-shm`; restore from a verified backup into a **new** path ([backup and restore](backup-restore.md)) |
| `RUNTIME_UNAVAILABLE` | App error, or identity runtime failed while config and database look fine | Read `stderr.log`; restart; if it persists after an upgrade, roll back |
| Sign-in works on the Mac but not from the phone | Wrong `AUTH_ORIGIN`/build origin, Serve not running, phone off the tailnet | Preflight `build-origin`; `pilot-tailscale-check`; check the phone's Tailscale; `--probe-https` |
| Origin error after changing the URL | The build embeds the old origin | Export the new `AUTH_ORIGIN`, rebuild, restart |
| Many sign-in failures at once | Production limit is three attempts per ten seconds, shared per process | Wait; it resets on restart |
| Display shows "Pairing required" | Revoked, expired, orphaned (pairing parent disabled) or cookie lost | Check Household displays; re-pair |
| App not running after reboot | A LaunchAgent starts only after the service user logs in | Log in; decide deliberately whether to use automatic login |
| Mac asleep, phone cannot connect | Sleeping hosts do not serve | Adjust sleep yourself; this tooling never changes it |
| Logs growing | launchd does not rotate; the launcher truncates only at (re)start | Restart; check size |

Rollback of a failed upgrade: stop the service, keep the failed database untouched for inspection, check out the previous commit, rebuild with the matching `AUTH_ORIGIN`, point `DATABASE_PATH` at a restored pre-upgrade backup copy, start, run the health check.
