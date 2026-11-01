#!/bin/sh
set -eu
[ "$#" -eq 0 ] || { echo 'push-branch takes no arguments' >&2; exit 2; }
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
cd "$root"
branch=$(git symbolic-ref --short -q HEAD) || { echo 'push-branch: detached HEAD' >&2; exit 1; }
case "$branch" in main|master|''|-*|*[!A-Za-z0-9._/-]*) echo 'push-branch: invalid feature branch' >&2; exit 1 ;; esac
[ -z "$(git status --porcelain --untracked-files=all)" ] || { echo 'push-branch: worktree is dirty' >&2; exit 1; }
git fetch origin main
git merge-base --is-ancestor origin/main HEAD || { echo 'push-branch: sync with origin/main first' >&2; exit 1; }
ref="refs/heads/$branch"
# Publish only this branch under its own name. The lease is pinned to the remote tip this clone last
# saw, and only `git fetch origin main` runs above, so a commit pushed by someone else fails the lease.
if expected=$(git rev-parse --verify -q "refs/remotes/origin/$branch"); then
  git push "--force-with-lease=$ref:$expected" origin "HEAD:$ref"
else
  git push origin "HEAD:$ref"
fi
