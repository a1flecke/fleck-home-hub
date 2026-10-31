#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
cd "$root"
if ! command -v mise >/dev/null 2>&1; then
  echo 'Install mise first: https://mise.jdx.dev/getting-started.html' >&2
  exit 1
fi
if ! MISE_LOCKED_SCOPES=project mise install --locked; then
  echo 'Locked tool installation failed. Review mise.toml and, if appropriate, run mise trust, then retry.' >&2
  exit 1
fi
mise run install
./scripts/setup-git-hooks.sh
./scripts/doctor.sh
printf '%s\n' 'Setup complete. Start the app with: mise run dev'
