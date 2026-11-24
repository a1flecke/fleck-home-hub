---
name: ship
description: Verify and publish a feature branch as a pull request without merging. Use when asked to ship, verify and push, or open a PR for current feature-branch work.
---

# Ship Feature Branch

Read `AGENTS.md` before proceeding.

## Steps

1. Confirm you are on a named feature branch (never `main` or detached HEAD) and review both committed and uncommitted changes.
2. Run required verification (`mise run agent-policy`, `mise run lint`, `mise run typecheck`, `mise run test`, and `mise run verify` as appropriate).
3. Commit intended changes cleanly without bypassing Git hooks.
4. Publish the feature branch (`git push`, or `scripts/push-branch.sh` after a user-requested rebase) and open or update the pull request.
5. Report all checks and limitations. Never merge or approve the PR.
