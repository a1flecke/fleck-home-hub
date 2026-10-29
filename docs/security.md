# Security

Use HTTPS through a private tailnet, a unique random `AUTH_SECRET`, and a private database path. Parent and kid roles are checked by the server for each household. Public signup is disabled; local host access is required to run the account-provisioning commands. Shared displays show synthetic data only. The manifest does not implement offline synchronization.

The native agent sandbox and approvals are primary controls. Claude's hook adds narrow checks, and malformed payloads exit 2, but command matching is not a shell parser and hook startup failures can be nonblocking. Git hooks are local safeguards, not an authoritative boundary; install them in each worktree. CI and configured branch protection must enforce checks independently. Never trust arbitrary command runners or use the project approval policy to weaken global restrictions.

Threats still requiring operational care include a stolen unlocked phone or session cookie, revoked tailnet access without session revocation, compromised host, filesystem access to the database or backups, and an unattended shared display. Sessions are revocable, but there is no account-management UI or MFA yet. Protect the Mac, backups, and all devices. Do not use production household data until operational controls and remote behavior are verified.

CI runs zizmor, Gitleaks and `pnpm audit --audit-level high`; lower-severity advisories also need review. PRs run without production secrets. Configure a branch protection rule or ruleset requiring the stable `merge-gate` check; repository administration may be needed. This repository does not itself enable or prove branch protection.
