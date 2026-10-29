#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
cd "$root"
HOST=${HOST:-127.0.0.1}
export HOST
exec mise exec -- node build
