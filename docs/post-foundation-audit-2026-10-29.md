# Post-foundation audit: initial findings

This is an interim audit, not a production-readiness certification. The live main ruleset was inspected on 2026-10-29; GitHub settings can change independently of this repository.

## Confirmed

- **P1 — No independent merge boundary.** The ruleset requires a PR and the `merge-gate` check but no approving reviews. The workflow and gate script are supplied by the PR itself. The only listed collaborator is the repository owner, so requiring that author's own approval would not provide independent review. CODEOWNERS is an ownership declaration, not enforcement. The changes needed in GitHub and the single-maintainer alternative are described in `security.md`.
- **P1 — Authentication migrations previously came from the installed library.** The former migration called Better Auth's generated migration at runtime, without a reviewed auth migration or recorded version. The checked-in baseline and compatibility checks address the pinned version. The auth and household transactions remain separate; recovery from a verified backup remains necessary after a failure.
- **P2 — OpenCode hard-deny patterns are incomplete.** The project's literal `git push --force` and `gh pr review ... --approve` patterns do not cover all argument orderings or command variants. They must not be treated as a complete shell security boundary. OpenCode and the separately maintained approval plugin were not available for a live integration test here. Global hard policies and native sandboxing remain necessary; review their effective behavior with synthetic configuration and adversarial commands before pilot use.
- **P2 — Dependency advisories.** A full pnpm audit reported one moderate esbuild advisory in the development dependency tree and one low deepmerge advisory. The configured high-severity gate passes, which does not resolve the lower-severity advisories. Review upstream fixes and upgrade compatibility rather than suppressing the audit.

## Existing controls and limitations

- The merge-gate tests reject failed, skipped, cancelled, missing and malformed job results. This does not make the gate independent of the PR.
- CI uses read-only repository permissions, does not persist checkout credentials, pins actions by commit, and runs frozen installation, parity, security scanning, and browser checks. The checkout action was updated to its v6 commit; actual hosted CI must still verify the update.
- Better Auth handles sessions and passwords; parent/kid membership checks run on the server. Current browser tests exercise a synthetic parent and child, not the future chores and ledger feature.
- The project relies on native sandbox and global OpenCode policies for protections that project-level pattern matching cannot reliably provide. The global configuration and credentials were not inspected or changed.
- HTTPS cookies depend on the configured authentication origin. CSP, HSTS, rate limiting, actual tailnet restrictions, device behavior, service restart behavior and complete disaster recovery still require further assessment.

This audit predates the chores feature. An independent review boundary, actual-device verification, and end-to-end operational recovery remain outstanding; this document does not certify readiness for a real household pilot.
