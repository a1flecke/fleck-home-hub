# Development

Install mise, review `mise.toml`, and run `mise trust` if prompted. `./scripts/bootstrap.sh` installs locked tools and frozen dependencies, configures worktree hooks without replacing another hooks path, and runs the doctor. The doctor does not print credentials and treats GitHub, OpenCode and Tailscale as optional.

Use `mise run dev`, `mise run lint`, `mise run typecheck`, `mise run test`, `mise run build`, and `mise run e2e`. Install the matching Chromium once with `mise exec -- pnpm exec playwright install chromium`; Linux may need Playwright's system dependencies. Run a single existing test with `./scripts/dev.sh test tests/authorization.test.ts`. The dispatcher only accepts its fixed tasks and validated test paths. `./scripts/run-with-mise.sh` is a general command runner and must never be automatically trusted by the approval plugin.

`mise run verify` runs policy/version checks, lint, typechecking, all unit/integration tests, build, browser tests, workflow analysis, secret scan and dependency audit. It requires network access for the dependency audit and a locally usable Playwright browser. Git pre-push runs a shorter check. `./scripts/sync-main.sh` merges the latest `origin/main` into a clean feature branch; `./scripts/push-branch.sh` performs an ordinary push only. Both accept no arguments. Resolve conflicts explicitly without discarding work.

A failing pre-commit scan reports filenames, not secret contents. These local checks supplement CI; they cannot cover every secret or dangerous shell expression.
