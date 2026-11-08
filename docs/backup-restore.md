# Backup, restore rehearsal and encrypted off-host copies

Everything here is a procedure to rehearse. **No restore on the real host, and no encrypted off-host copy, has been verified.** The automated tests use synthetic data only.

## 1. Taking a backup

`mise run backup /private/path/hub-YYYYMMDD.sqlite` (see [deployment](deployment.md)) uses SQLite's online backup, creates the file owner-only, refuses an existing path and runs `integrity_check`. A failed run can leave a new, incomplete destination: inspect and keep it, never reuse the name. Back up before every upgrade and on a schedule you will actually keep. A backup contains password hashes, session tokens, invitation and display-credential **hashes** and all household data: treat it as the most sensitive file you own.

## 2. Restore rehearsal (never touches the live database)

```bash
mkdir -m 700 "$HOME/hub-restore-rehearsal"
mise run pilot-restore-rehearsal -- --backup /private/path/hub-YYYYMMDD.sqlite --destination "$HOME/hub-restore-rehearsal/restored.sqlite" --config-file "$HOME/.config/fleck-home-hub/hub.conf" --migrate
```

What it does: validates absolute paths and a private destination directory; refuses an existing destination, the backup itself and the configured live database (and its `-wal`/`-shm`); copies the backup byte-for-byte into the new file (mode 600, no overwrite); runs `integrity_check` and `foreign_key_check`; with `--migrate`, applies migrations to the **copy** only (rehearses an upgrade, and reports a failed migration without touching anything else); then reports counts and PASS/WARN/FAIL for: every household has an active parent, disabled memberships remain disabled, every verified rewarded chore has exactly one earning and no earning belongs to an unverified chore, no child balance is negative, and how many unexpired sessions, unused invitations and active display credentials the snapshot contains. It prints **no** emails, names, ids, tokens, secrets or amounts, and it never deletes anything. It does not read your live database.

Cleanup: when finished, stop anything using the copy and remove `restored.sqlite` (and any `-wal`/`-shm`) and the rehearsal directory yourself. A rehearsal copy of real data is as sensitive as the backup, so remove it promptly.

### What the rehearsal does not prove

It does not start the application on the copy or sign anyone in. Automated tests do that with **synthetic** accounts (sign-in, balances, disabled memberships, display credential/revocation state after restore), and `mise run recovery-test` boots the production server on a restored synthetic database. To check the application on a copy of real data you must start a separate instance yourself: copy `hub.conf` to a new mode-600 file with a different `DATABASE_PATH` and `PORT`, run `HUB_ENV_FILE=… HUB_MISE="$(command -v mise)" HUB_LOG_DIR=… scripts/pilot/launch.sh` in a terminal, and run `mise run pilot-health -- --config-file <that file>`. That proves the identity runtime opens the copy. An actual browser sign-in on a rehearsal instance additionally needs a build whose `AUTH_ORIGIN` matches the rehearsal origin (the build embeds the origin), which is not set up here. **Manual, not performed.**

## 3. Restoring for real: stale credentials warning

Restoring an older snapshot **restores previously valid sessions, unused invitation links and paired-display credentials**, and forgets revocations, member disabling and password changes made after the snapshot. After any real restore, before reopening access:

1. Stop the service. Keep the previous database and its WAL/SHM files untouched; restore into a new path and point `DATABASE_PATH` at it; rebuild is not needed unless the origin changed.
2. Run the health check, then sign in as a parent.
3. **Household members:** confirm each person who should be disabled is disabled; re-disable as needed.
4. **Household displays** (`/settings/displays`): revoke every display you do not recognise or that was revoked after the snapshot date, then re-pair the real screens if in doubt. Display credentials are looked up by hash, so changing `AUTH_SECRET` does **not** revoke them.
5. **Invitations:** revoke pending links you did not just create.
6. **Sessions:** to end every personal session at once, rotate `AUTH_SECRET` (new random value in the private file, restart); cookies signed with the old value should stop validating, which everyone experiences as a forced sign-in. This has not been tested here. Individuals can also end sessions at `/settings/sessions`.
7. Compare balances with the household's own records before resuming payouts.

## 4. Encrypted off-host backup: design and approval boundary

Goal: a copy that survives loss of the Mac and does not expose household data if the copy is stolen. **This repository does not implement or automate it.** Doing so needs choices only the household can approve (a tool to trust, where keys live, where copies go), and it must not handle passphrases for you. The rules: never store a passphrase or private key in this repository, in shell arguments, in logs or in the plist; never auto-generate and store a password; no cloud-sync integration without a separate reviewed change.

### Option A (recommended once approved): `age` with a recipient public key

[`age`](https://github.com/FiloSottile/age) encrypts to a public key, so the Mac only ever holds the public recipient string; the private identity stays offline, which means a compromised Mac cannot read old copies and no passphrase is typed on the Mac. **Not approved or added**, because adding it requires: a human review of the project and a pinned version; adding it to `mise.toml` and regenerating `mise.lock` with checksums (reviewed like any toolchain change); and recording the recipient. Key management you must decide: where the private identity lives (offline, at least two physically separate copies, e.g. printed or on encrypted removable media); who may use it; a recovery drill that decrypts a copy on a different machine. Losing every copy of the private identity makes every backup permanently unreadable. Rotate by generating a new key pair, encrypting new backups to both during overlap, and retiring the old key only when no needed backup depends on it. Usage shape after approval (names illustrative): `age -r <public-recipient> -o backup.sqlite.age backup.sqlite`, then copy the `.age` file off-host and delete the plaintext copy.

### Option B (no new tool): encrypted disk image with macOS `hdiutil`

Built into macOS, so nothing new to trust or pin, but it uses a passphrase that you type and must manage:

```bash
hdiutil create -encryption AES-256 -size 200m -fs APFS -volname HubBackup "$HOME/hub-backup-YYYYMMDD.dmg"   # prompts for the passphrase in the terminal
hdiutil attach "$HOME/hub-backup-YYYYMMDD.dmg"      # prompts for the passphrase
cp /private/path/hub-YYYYMMDD.sqlite /Volumes/HubBackup/ && hdiutil detach /Volumes/HubBackup
```

Do not use `-stdinpass` with a passphrase in a script, history or log. Store the passphrase in a password manager the household controls, plus a sealed offline copy; losing it loses the backups. Size the image for the database plus headroom. **Checked on one Mac with a synthetic passphrase and synthetic bytes in a scratch folder:** creating an AES-256 image, attaching it with the passphrase and seeing it reported as encrypted. **Not checked:** the interactive prompts, behaviour with a wrong passphrase, that the database content is absent from the image file, restore of a real backup from the image, behaviour on other macOS versions, or any copy to another host.

### Either way, the household must still decide and verify

- The off-host destination (another computer you control, removable media, or a provider you have reviewed) and who can read it.
- A retention schedule, and a periodic full drill: decrypt on a different machine, run the rehearsal above, and record the result in the [pilot test plan](pilot-test-plan.md).
- That a backup you cannot decrypt is not a backup.
