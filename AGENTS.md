# Fleck Home Hub agent policy

Fleck Home Hub is a private, self-hosted household application. Keep it a modular monolith: presentation calls application services; domain rules do not depend on UI or persistence; infrastructure implements concrete adapters. Do not invent abstractions for unimplemented domains.

Use test-driven development for meaningful behavior: write a focused failing test, implement the smallest correct change, and refactor. Test authorization at the server boundary, including anonymous, child, and cross-household access. A child chore submission is pending until a parent verifies it; only verification may create exactly one reward credit.

Use mise as the tool-version authority: `mise install --locked`, `mise run install`, `mise run dev`, `mise run lint`, `mise run typecheck`, `mise run test`, `mise run build`, `mise run e2e`, and `mise run parity`. Run focused tests first and the complete required checks before delivery. Report checks that did not run.

Read the issue and relevant code before changes. Work on a feature branch or isolated worktree; never commit or push directly to main. Preserve unrelated changes. Review the complete diff, verify the work, commit, and open a PR. Never merge or approve your own PR, force-push, delete a protected branch, or bypass failed checks. Ask the user before deployment, destructive operations, changing global machine or agent configuration, or accessing unrelated private directories. Never run broad process termination commands.

Treat household information, local databases, environment files, authentication secrets, and backups as private. Use only synthetic fixtures. Do not read, print, copy, or commit credentials or private household data. Never alter the user's global OpenCode configuration or install an approval plugin. Native sandbox and approval controls, Git hooks, and CI each provide separate safeguards; repository instructions do not replace them.

Keep documentation accurate and concise. Record material architecture and security decisions. State risks and limitations honestly, especially untested remote access, platform behavior, and branch protections. Do not claim validation or enforcement without evidence.
