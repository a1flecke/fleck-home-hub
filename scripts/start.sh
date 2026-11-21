#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
cd "$root"
HOST=${HOST:-127.0.0.1}
export HOST
# Libraries such as Better Auth enable production safeguards only for this exact value.
NODE_ENV=production
export NODE_ENV
exec mise exec -- node build
