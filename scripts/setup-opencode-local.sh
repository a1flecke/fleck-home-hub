#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
cd "$root"
[ -f .opencode/opencode.jsonc ] || { echo 'OpenCode project configuration missing' >&2; exit 1; }
if command -v opencode >/dev/null 2>&1; then
  opencode --version
else
  echo 'Optional: OpenCode CLI not found.'
fi
printf '%s\n' 'Approval-plugin presence and trusted roots require manual verification. No global configuration was read or changed.'
