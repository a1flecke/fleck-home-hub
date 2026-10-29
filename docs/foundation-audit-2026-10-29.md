# Independent foundation audit

Baseline: merge commit `053d6bb7df5879e1aef87a97f1faed13ae419733` on `main`. The fixes in this PR are separate from that baseline. Severity reflects the impact if the foundation is used for real household data, not a claim that any data was compromised.

References: [OpenCode V2 permissions](https://dev.opencode.ai/v2/docs/permissions/), [OpenCode V2 policies](https://dev.opencode.ai/v2/docs/policies/), [approval plugin README](https://github.com/a1flecke/opencode-auto-approval), [Git worktree configuration](https://git-scm.com/docs/git-worktree#_configuration_file), and the [Conquestoria workflow](https://github.com/a1flecke/conquestoria/blob/main/.github/workflows/deploy.yml). Upstream behavior can change; the installed OpenCode/plugin version was not verified.

## P1 — Origin is not checked on the parent mutation (confirmed; fixed in this PR)

- Location: `src/lib/server/identity.ts`, baseline `parentAction` around line 37; route `src/routes/api/households/[householdId]/parent-test/+server.ts`.
- Evidence: an authenticated parent request with an attacker-controlled `Origin` returned 204 in a synthetic integration test. SameSite cookies reduce cross-site exposure, but do not replace an explicit origin check for same-site cross-origin requests. This endpoint is currently a no-op; the risk grows if the pattern is copied to real mutations.
- Fix: require the configured canonical origin for authenticated mutations; reject missing or different origins. Apply the same invariant to every future mutation, including non-browser clients, which must provide `Origin`.
- Regression: `tests/auth.integration.test.ts` checks accepted, absent and hostile origins with a real session; `e2e/smoke.spec.ts` exercises the actual HTTP endpoint.

## P1 — Project OpenCode rules are not a complete hard security boundary (confirmed configuration gap; unresolved)

- Location: `.opencode/opencode.jsonc:4` and `:9`; `scripts/check-agent-policy-parity.mjs:21`.
- Evidence: project permissions use broad `ask` rules, not denies for database or credential reads. OpenCode V2 documents default read access, ordered permission precedence, and separately evaluated hard policies; project settings and agent rules must be considered with global rules. The hard-deny patterns cover selected literal command shapes only: for example, `git push origin branch --force` does not match `shell:git push --force *`, and `gh pr review --approve` does not match the longer pattern requiring a preceding argument. The parity checker merely verifies the literal patterns exist. A reviewer plugin may approve an `ask`, so it cannot turn these narrow patterns into comprehensive prohibitions.
- Fix: place non-overridable prohibitions in user-managed/global or managed hard policy, use a reviewed command classifier for dangerous variants, and explicitly protect household/credential paths. Do not weaken or rewrite user configuration automatically. Confirm rule precedence and plugin behavior using the exact installed OpenCode version in an isolated configuration before depending on it.
- Regression needed: exercise actual OpenCode permission evaluation for option ordering, aliases, shell composition, sensitive reads, global denies and reviewer timeout/failure; assert hard-denied requests never reach auto-approval. The installed plugin and global configuration were not inspected, so their current protections are unknown.

## P1 — The required merge gate is controlled by the proposed change (confirmed design risk; unresolved)

- Location: `.github/workflows/ci.yml:71` and `scripts/verify-merge-gate.mjs:1`.
- Evidence: the gate checks out the PR revision and executes its `scripts/verify-merge-gate.mjs`; the PR can also alter the workflow and job names. A passing required check therefore does not independently attest that the intended security and test jobs ran. GitHub's live ruleset requires `merge-gate` from GitHub Actions and blocks direct main changes, but requires zero independent approvals. This is also a pattern in the inspected Conquestoria workflow, not an independent trust guarantee.
- Fix: require human review of workflow, gate, toolchain and policy changes, ideally using protected code owners and an independent reviewer; where available, use an independently controlled required workflow or GitHub App. Avoid claiming that the gate prevents a malicious PR author from editing the gate itself.
- Regression needed: in a disposable repository, submit a synthetic PR changing the gate to always succeed or removing a required job, and verify the protected review/independent check blocks it. Existing unit tests only test the script's supplied result values.

## P2 — Claude hook inspects the wrong Git context for composed commands (confirmed; partially fixed)

- Location: `.claude/hooks/guard.mjs`, baseline lines 8–12.
- Evidence: the baseline hook returned success without an `ask` for `git -C /tmp/example commit -m example`; it inspected the event's original working directory for `cd … && git commit`. A direct `git commit --no-verify` also bypassed the local Git hook. This does not establish a bypass of Claude's native permission prompts.
- Fix: ask on detected Git context/config changes and composed `cd` plus commit, and block direct `--no-verify`/`-n`. Keep native permissions and sandbox enabled: regex matching cannot parse shell, wrappers, aliases, environment variables, or every flag order.
- Regression: `tests/claude-hook.test.ts` tests documented event payloads for these examples, safe commands and malformed input. Additional shell-grammar and native-Claude integration tests remain needed.

## P2 — Missing browser and cache protections (confirmed; fixed in this PR)

- Location: `src/hooks.server.ts`, baseline lines 6–12.
- Evidence: actual local responses lacked `X-Content-Type-Options`, `X-Frame-Options`, and `Cache-Control: no-store` on the authenticated dashboard. Browsers or intermediaries may retain private pages, and the site lacked basic clickjacking and MIME-sniffing defenses.
- Fix: add `nosniff`, frame denial and a restrictive referrer policy; mark dashboard and API responses `no-store`. A tested Content Security Policy and production HTTPS/HSTS strategy remain follow-up work; do not blindly enable HSTS on local HTTP.
- Regression: `e2e/smoke.spec.ts` checks response headers and authenticated dashboard caching in a browser.

## P2 — Plugin installation guidance contradicts upstream (confirmed; corrected in this PR)

- Location: `docs/agent-workflows.md:9`.
- Evidence: the plugin's current public README instructs users to register a clone; the baseline project text calls its separate release-artifact workflow the plugin's current README procedure. This could lead to an incompatible entry point or a less-reviewed installation. The user explicitly requires verified releases and prohibits installing a development checkout into auto-discovery.
- Fix: document the discrepancy, require human review of the exact versioned artifact, checksum, attestation, entry point and rollback, and stop if compatibility is uncertain. Do not change user configuration.
- Regression needed: periodically compare the documented instructions to a pinned upstream release and test installation in a disposable OpenCode profile without credentials. This audit did not install or execute the plugin.

## P2 — Authentication schema changes are generated at runtime (confirmed risk; unresolved)

- Location: `src/lib/server/identity.ts:24`.
- Evidence: Better Auth computes and applies its migration from the currently installed library, before the checked-in Drizzle migration. Upgrades can change database schema without a reviewed, versioned authentication migration; backup integrity alone does not demonstrate application-level recovery.
- Fix: generate and review version-controlled auth migrations for the pinned release, test upgrades from a prior synthetic database and exercise a restore with login and membership checks.
- Regression needed: migrate an old-version fixture twice, verify its data and sessions, simulate a failing migration and restore a verified backup. Real household recovery remains untested.

## P2 — Git worktree configuration migration is incomplete (confirmed; fixed in this PR)

- Location: `scripts/setup-git-hooks.sh:11`.
- Evidence: the script enables shared `extensions.worktreeConfig` without checking existing per-worktree `core.worktree`/`core.bare` settings. Git's worktree documentation calls for moving relevant settings before enabling this extension. Existing tests cover ordinary repositories and a linked worktree, not pre-existing non-default settings.
- Fix: refuse to enable the extension when shared `core.worktree` or a bare setting requires manual migration; never silently rewrite unrelated configuration.
- Regression: `tests/setup-hooks.test.ts` checks ordinary and linked worktrees and asserts that a shared `core.worktree` remains unchanged when setup refuses. Tests with bare repositories and configurations already using the extension remain follow-up work.

## P3 — Maintenance and release readiness

- Location: `.github/workflows/ci.yml:17`; `docs/deployment.md:3`.
- Evidence: the last CI run warned that the pinned checkout action targets deprecated Node 20 and is currently forced onto Node 24. macOS launchd, Tailscale Serve, iOS installation, sleep/wake and real backup recovery remain unverified; the docs correctly say so.
- Fix: review and pin a maintained checkout release, validate the workflow, and complete the documented manual deployment and recovery procedures before production use.
- Regression needed: run the full CI on the pinned action and perform the documented host, phone and restore checks with synthetic data.

## What is enforced

The server validates Better Auth sessions and household membership, disables public signup, and rejects child or cross-household parent actions. The local Git hooks and Claude hook add best-effort checks, but can be bypassed or fail to start and are not a sandbox. The dispatcher rejects unexpected tasks, traversal, symlinks and tested metacharacters. The merge-gate script rejects failed, skipped, cancelled, missing and malformed results when its own code is trusted.

The live GitHub ruleset requires a pull request and a GitHub Actions `merge-gate`, requires an up-to-date branch, blocks deletion and force pushes, and has no bypass actors. GitHub Actions requires SHA-pinned actions; default token permissions are read-only; secret scanning and push protection are enabled. These are live service settings, not guarantees supplied by repository files.

Shared `AGENTS.md`, Claude and OpenCode instructions prescribe common engineering behavior but cannot enforce it on their own. Plugin installation, trusted roots, reviewer fail-closed behavior, actual global/agent rule precedence, Tailscale isolation and deployment procedures are not verified by this audit. The inspected upstream plugin describes fail-closed reviewer behavior and trusted-worktree/script integrity checks; it is not reimplemented here, and no user-owned global settings or credentials were read or changed.

## Assessment

Do not treat the landed foundation as production-ready. This PR addresses the reproduced request-origin, response-header, selected Claude-hook, worktree-configuration and documentation defects. The OpenCode hard-policy boundary and self-controlled merge gate still need an explicit owner decision and independent enforcement before those controls can be relied on as security guarantees. No P0 was established in the reviewed scope.
