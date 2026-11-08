# Pilot test plan and results template

**Every result below is `NOT TESTED`.** This file is the template. Do not edit results into this committed copy: copy it to a private location outside the repository, fill in actual results there, and strip anything sensitive (no secrets, cookies, tokens, pairing codes, emails, real names, IPs or screenshots of household data). Evidence must be sanitised and independently observed; mocked tests do not count for launchd, Tailscale, iPhone or display rows. A repository test fails if this file claims anything other than `NOT TESTED`.

Result values: `PASS`, `FAIL`, `NOT TESTED`. Record Device/OS (for example model and iOS/macOS version), the date, and notes or sanitised evidence. Related: [deployment](deployment.md), [Tailscale validation](tailscale-validation.md), [backup and restore](backup-restore.md), [troubleshooting](pilot-troubleshooting.md). Independent review is required before real household use.

## Mac lifecycle

| ID | Test | Expected result | Actual result | Result | Device/OS | Date | Notes / evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MAC-01 | Preflight has no FAIL on the host, and every WARN/UNKNOWN is explained in Notes | `mise run pilot-preflight` exits 0; no FAIL |  | NOT TESTED |  |  |  |
| MAC-02 | Dry-run `install` prints the plan and creates nothing | No plist file, no launchctl call |  | NOT TESTED |  |  |  |
| MAC-03 | `install --apply` loads the agent; `status --apply` shows it running | Agent loaded; health = HEALTHY |  | NOT TESTED |  |  |  |
| MAC-04 | Log in after a fresh reboot | App starts after login (record whether it starts before login: expected NO) |  | NOT TESTED |  |  |  |
| MAC-05 | Terminate the node process by its specific PID (never a broad process-name kill) | Health NOT_LISTENING, then launchd restarts it within ~30 s and health = HEALTHY |  | NOT TESTED |  |  |  |
| MAC-06 | Break the private config (e.g. mode 644) and restart | Launcher refuses (exit 78), message shows no secret value; fixing it recovers within ~30 s |  | NOT TESTED |  |  |  |
| MAC-07 | Reboot the Mac | After login and unlock, health = HEALTHY without manual steps |  | NOT TESTED |  |  |  |
| MAC-08 | Sleep then wake | Service responds again within a stated time; note household sleep settings used |  | NOT TESTED |  |  |  |
| MAC-09 | Disconnect then reconnect the network | Loopback service unaffected; phone access returns after reconnect |  | NOT TESTED |  |  |  |
| MAC-10 | Inspect logs | Logs exist in the private log dir, mode 600/700, contain no secrets, and stay under the size bound after restarts |  | NOT TESTED |  |  |  |
| MAC-11 | Upgrade: backup, stop, migrate, rebuild, start | Health = HEALTHY; data intact |  | NOT TESTED |  |  |  |
| MAC-12 | Rollback: previous commit + build + pre-upgrade backup restored to a new path | Health = HEALTHY on the old version; nothing overwritten |  | NOT TESTED |  |  |  |
| MAC-13 | `uninstall --apply` | Agent unloaded and only the project plist removed |  | NOT TESTED |  |  |  |

## Tailscale and private HTTPS

| ID | Test | Expected result | Actual result | Result | Device/OS | Date | Notes / evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| NET-01 | Inspect existing Serve/Funnel state before changing anything; save the JSON | Before-state recorded privately |  | NOT TESTED |  |  |  |
| NET-02 | `pilot-tailscale-check` on the saved JSON | No FAIL; Funnel not enabled |  | NOT TESTED |  |  |  |
| NET-03 | After the manual Serve step, the route proxies only to 127.0.0.1:PORT | Checker PASS for `route` |  | NOT TESTED |  |  |  |
| NET-04 | Phone on a non-home network opens the HTTPS URL | No certificate warning; sign-in page loads |  | NOT TESTED |  |  |  |
| NET-05 | A device not on the tailnet tries the URL | Cannot connect |  | NOT TESTED |  |  |  |
| NET-06 | Anonymous request to a household page | Redirect to sign-in or 401/403; no household data |  | NOT TESTED |  |  |  |
| NET-07 | Router port forwarding and Funnel absent | Neither configured (state how checked) |  | NOT TESTED |  |  |  |
| NET-08 | Secure cookies over the real origin | Session cookie Secure+HttpOnly; display cookie scoped to /display |  | NOT TESTED |  |  |  |
| NET-09 | Wrong build-time origin | Preflight `build-origin` FAIL; fixed by rebuild |  | NOT TESTED |  |  |  |

## iPhone

| ID | Test | Expected result | Actual result | Result | Device/OS | Date | Notes / evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IPH-01 | Safari over the tailnet on home Wi-Fi | Page loads, sign in works |  | NOT TESTED |  |  |  |
| IPH-02 | Safari from cellular / non-home network | Same result |  | NOT TESTED |  |  |  |
| IPH-03 | Add to Home Screen | Icon and name correct (record what iOS shows for the SVG icon) |  | NOT TESTED |  |  |  |
| IPH-04 | Launch the standalone web app | Opens without Safari chrome; still signed in or prompts sign-in (record which) |  | NOT TESTED |  |  |  |
| IPH-05 | Sign out then sign in again | Sign-out ends the session; protected pages redirect |  | NOT TESTED |  |  |  |
| IPH-06 | Session persistence across app restart and Mac restart | Behaviour recorded; no unexpected sign-out |  | NOT TESTED |  |  |  |
| IPH-07 | Session expiry (7 days) or manual revoke at /settings/sessions | Device returns to sign-in after expiry/revoke |  | NOT TESTED |  |  |  |
| IPH-08 | Parent can create invitation, disable a test member | Allowed |  | NOT TESTED |  |  |  |
| IPH-09 | Child cannot reach household admin or other children's data | 403/redirect; no data |  | NOT TESTED |  |  |  |
| IPH-10 | Disabled member's existing session | Next request denied |  | NOT TESTED |  |  |  |
| IPH-11 | Grocery list refresh through a temporary Mac outage (owned by the grocery work) | Clear outage message, recovers after the Mac returns |  | NOT TESTED |  |  |  |
| IPH-12 | Recipe link entry | Link saved or clear error; no crash |  | NOT TESTED |  |  |  |
| IPH-13 | Calendar event and chore actions (submit / verify) | Work as parent and child; child cannot verify |  | NOT TESTED |  |  |  |

## Paired family display

| ID | Test | Expected result | Actual result | Result | Device/OS | Date | Notes / evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DSP-01 | Parent creates a pairing code at /settings/displays and the screen redeems it | Display shows allowed content |  | NOT TESTED |  |  |  |
| DSP-02 | No ordinary account remains signed in on the display browser | No personal session cookie present |  | NOT TESTED |  |  |  |
| DSP-03 | Reload and reopen the display | Still paired; never reaches non-display pages |  | NOT TESTED |  |  |  |
| DSP-04 | Only approved events/chores/meals are shown | Nothing unapproved appears; no private fields |  | NOT TESTED |  |  |  |
| DSP-05 | Weather provider outage | Display shows a sensible weather-unavailable state |  | NOT TESTED |  |  |  |
| DSP-06 | Mac outage then recovery | Connection message during outage, normal after (not stale-looking success) |  | NOT TESTED |  |  |  |
| DSP-07 | Revoke the display from a parent's phone | Pairing required within ~60 s; reload cannot restore it (record the measured time) |  | NOT TESTED |  |  |  |
| DSP-08 | Disable the parent who paired a display | Display stops working |  | NOT TESTED |  |  |  |
| DSP-09 | Expired credential (record how it was induced) | Pairing required |  | NOT TESTED |  |  |  |
| DSP-10 | Lost or stolen screen procedure: revoke, re-pair replacement, review members | Old device denied; replacement works |  | NOT TESTED |  |  |  |
| DSP-11 | Display survives sleep/wake of the display and Mac | Recovers without re-pairing |  | NOT TESTED |  |  |  |

## Recovery

| ID | Test | Expected result | Actual result | Result | Device/OS | Date | Notes / evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| REC-01 | Backup taken and integrity checked | `mise run backup` succeeds; file mode 600 |  | NOT TESTED |  |  |  |
| REC-02 | Verified off-host copy exists (state method; encryption method approved by the household) | Copy decrypts on another machine |  | NOT TESTED |  |  |  |
| REC-03 | Restore rehearsal into a separate path | `pilot-restore-rehearsal` has no FAIL; live DB unchanged |  | NOT TESTED |  |  |  |
| REC-04 | Post-restore integrity | integrity PASS |  | NOT TESTED |  |  |  |
| REC-05 | Health on a rehearsal instance of the copy | HEALTHY |  | NOT TESTED |  |  |  |
| REC-06 | Authentication on a rehearsal build/origin | Parent and child sign in (document how origin was matched) |  | NOT TESTED |  |  |  |
| REC-07 | Balances match the household's own records | Match |  | NOT TESTED |  |  |  |
| REC-08 | Disabled memberships remain disabled | Confirmed |  | NOT TESTED |  |  |  |
| REC-09 | Display credentials and revocations | Active vs revoked match expectations |  | NOT TESTED |  |  |  |
| REC-10 | Revocation review after restoring an older snapshot | Stale sessions/invitations/displays revoked per backup-restore.md |  | NOT TESTED |  |  |  |
| REC-11 | Failed migration on a copy | Reported; live database untouched |  | NOT TESTED |  |  |  |
