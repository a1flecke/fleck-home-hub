#!/bin/sh
set -eu
cd "$(git rev-parse --show-toplevel)"
mise run parity
mise run agent-policy
mise run lint
mise run typecheck
mise run test
mise run build
