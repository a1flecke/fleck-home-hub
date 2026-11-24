---
name: work-issue
description: Implement a GitHub issue with focused tests and open a pull request following project policy. Use when asked to work on or implement a repository issue.
---

# Work Issue

Read `AGENTS.md` and inspect the target GitHub issue (`gh issue view <number>`).

## Steps

1. Inspect relevant code and work on an isolated feature branch or sibling worktree in `../fleck-home-hub-worktrees` based on `origin/main` (never commit directly to `main`).
2. Write focused failing tests first, confirm they fail for the intended reason, implement the smallest correct change, and keep tests green.
3. Run required verification (`mise run lint`, `mise run typecheck`, focused tests, and `mise run verify` as appropriate).
4. Review the complete diff, commit intended changes without bypassing Git hooks, push the feature branch, and open a pull request.
5. Report all checks run, checks not run, and any limitations. Never merge or approve the PR.
