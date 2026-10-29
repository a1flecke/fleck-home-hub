#!/bin/sh
set -eu
[ "$#" -eq 0 ] || { echo 'sync-main takes no arguments' >&2; exit 2; }
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
cd "$root"
branch=$(git symbolic-ref --short -q HEAD) || { echo 'sync-main: detached HEAD' >&2; exit 1; }
case "$branch" in main|master|'') echo 'sync-main: feature branch required' >&2; exit 1 ;; esac
[ -z "$(git status --porcelain --untracked-files=all)" ] || { echo 'sync-main: worktree is dirty' >&2; exit 1; }
git fetch origin main
git merge --no-edit origin/main
