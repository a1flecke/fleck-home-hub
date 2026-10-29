#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
cd "$root"
[ "$#" -gt 0 ] || { echo 'Usage: ./scripts/run-with-mise.sh command [arguments]' >&2; exit 2; }
exec mise exec -- "$@"
