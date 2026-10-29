#!/bin/sh
set -eu
root=$(git rev-parse --show-toplevel)
cd "$root"
[ -d .githooks ] || { echo 'setup-git-hooks: .githooks is missing' >&2; exit 1; }
existing=$(git config --get core.hooksPath || true)
if [ -n "$existing" ] && [ "$existing" != .githooks ]; then
  echo "setup-git-hooks: existing core.hooksPath is '$existing'; leaving it unchanged" >&2
  exit 1
fi
if [ "$(git config --local --get extensions.worktreeConfig || true)" != true ]; then
  echo 'setup-git-hooks: enabling Git worktree-specific configuration in this repository'
  git config --local extensions.worktreeConfig true
fi
git config --worktree core.hooksPath .githooks
[ "$(git config --worktree --get core.hooksPath)" = .githooks ]
echo 'setup-git-hooks: enabled .githooks for this worktree'
