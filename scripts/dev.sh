#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
usage() { echo 'Usage: ./scripts/dev.sh {start|build|typecheck|lint|test|test-all|e2e|verify|doctor}' >&2; exit 2; }
[ "$#" -ge 1 ] || usage
task=$1
shift
case "$task" in
  start|build|typecheck|lint|test-all|verify|doctor)
    [ "$#" -eq 0 ] || usage
    case "$task" in
      start) exec mise exec -- pnpm run dev ;;
      build) exec mise exec -- pnpm run build ;;
      typecheck) exec mise run typecheck ;;
      lint) exec mise run lint ;;
      verify) exec mise run verify ;;
      doctor) exec mise run doctor ;;
      test-all) exec mise exec -- pnpm run test ;;
    esac ;;
  test|e2e)
    if [ "$task" = e2e ] && [ "$#" -eq 0 ]; then exec mise exec -- pnpm run e2e; fi
    [ "$#" -eq 1 ] || usage
    case "$task:$1" in test:tests/*.test.ts|e2e:e2e/*.spec.ts) ;; *) usage ;; esac
    case "$1" in *..*|*//*|*[!a-zA-Z0-9_./-]*) usage ;; esac
    [ -f "$1" ] || usage
    current=.
    path=$1
    while [ -n "$path" ]; do
      part=${path%%/*}
      current=$current/$part
      [ ! -L "$current" ] || usage
      case "$path" in */*) path=${path#*/} ;; *) path= ;; esac
    done
    if [ "$task" = test ]; then exec mise exec -- pnpm exec vitest run "$1"; fi
    exec mise exec -- pnpm exec playwright test "$1" ;;
  *) usage ;;
esac
