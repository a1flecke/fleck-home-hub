#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
cd "$root"
mise run parity
mise run agent-policy
mise run lint
mise run typecheck
mise run test
mise run build
mise run recovery-test
mise run e2e
mise exec -- zizmor --offline .github/workflows
mise exec -- gitleaks dir --no-banner --redact .
mise exec -- pnpm audit --audit-level moderate
