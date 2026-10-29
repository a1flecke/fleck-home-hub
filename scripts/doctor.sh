#!/bin/sh
set -u
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
cd "$root"
failed=0
if command -v mise >/dev/null 2>&1; then
  if mise run parity; then :; else echo 'Required: tool version parity failed' >&2; failed=1; fi
else echo 'Required: mise is missing' >&2; failed=1; fi
[ -d node_modules ] || { echo 'Required: dependencies not installed' >&2; failed=1; }
branch=$(git symbolic-ref --short -q HEAD 2>/dev/null || printf 'detached')
printf 'Branch: %s\n' "$branch"
hooks=$(git config --worktree --get core.hooksPath 2>/dev/null || true)
[ "$hooks" = .githooks ] || { echo 'Required: Git hooks not configured for this worktree' >&2; failed=1; }
[ -f .claude/settings.json ] && [ -f AGENTS.md ] && [ -f .opencode/opencode.jsonc ] || { echo 'Required: agent configuration missing' >&2; failed=1; }
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then echo 'GitHub CLI: available and authenticated'; else echo 'Optional: GitHub CLI unavailable or not authenticated'; fi
if command -v opencode >/dev/null 2>&1; then echo 'OpenCode: available; review plugin setup manually'; else echo 'Optional: OpenCode not found'; fi
if command -v tailscale >/dev/null 2>&1; then echo 'Tailscale: CLI available; connectivity not checked'; else echo 'Optional: Tailscale not found'; fi
exit "$failed"
