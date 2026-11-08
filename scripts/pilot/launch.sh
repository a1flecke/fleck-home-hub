#!/bin/sh
# Minimal LaunchAgent launcher for Fleck Home Hub.
#
# launchd starts this script with a tiny environment (see the generated plist).
# It loads the private configuration file as DATA (never sourced or evaluated),
# validates it, refuses anything that is not loopback-bound, rotates oversized
# logs, then execs scripts/start.sh using the pinned mise. Configuration errors
# exit 78 (EX_CONFIG) after printing a message that never contains a value.
set -eu
umask 077

fail() { printf 'fleck-home-hub launcher: refusing to start: %s\n' "$1" >&2; exit 78; }

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
cd "$root"

# Do not inherit anything that could change trust or the listener.
unset AUTH_SECRET DATABASE_PATH AUTH_ORIGIN HOST PORT SOCKET_PATH ORIGIN \
  PROTOCOL_HEADER HOST_HEADER PORT_HEADER ADDRESS_HEADER XFF_DEPTH BODY_SIZE_LIMIT

file=${HUB_ENV_FILE:-}
mise=${HUB_MISE:-}
logdir=${HUB_LOG_DIR:-}
[ -n "$file" ] || fail 'HUB_ENV_FILE is not set'
case $file in /*) ;; *) fail 'HUB_ENV_FILE must be an absolute path' ;; esac
case $mise in /*) ;; *) fail 'HUB_MISE must be an absolute path' ;; esac
[ -x "$mise" ] || fail 'HUB_MISE is not executable'
[ ! -L "$file" ] || fail 'configuration file must not be a symlink'
[ -f "$file" ] || fail 'configuration file not found'
[ -O "$file" ] || fail 'configuration file is not owned by the service user'
mode=$(stat -c %a "$file" 2>/dev/null || stat -f %Lp "$file" 2>/dev/null || echo unknown)
case $mode in *00) ;; *) fail 'configuration file must not be accessible by group or others (chmod 600)' ;; esac

seen=' '
while IFS= read -r line || [ -n "$line" ]; do
  case $line in '' | '#'*) continue ;; esac
  key=${line%%=*}
  value=${line#*=}
  [ "$key" != "$line" ] || fail 'configuration line is not KEY=VALUE'
  case $key in
    AUTH_SECRET | DATABASE_PATH | AUTH_ORIGIN | HOST | PORT) ;;
    *) fail 'configuration contains a key that is not allowed' ;;
  esac
  case $seen in *" $key "*) fail "$key is defined twice" ;; esac
  seen="$seen$key "
  case $value in
    \"*\") value=${value#\"}; value=${value%\"} ;;
    \'*\') value=${value#\'}; value=${value%\'} ;;
  esac
  export "$key=$value"
done < "$file"

[ -n "${AUTH_SECRET:-}" ] && [ "${#AUTH_SECRET}" -ge 32 ] || fail 'AUTH_SECRET is missing or shorter than 32 characters'
[ -n "${DATABASE_PATH:-}" ] || fail 'DATABASE_PATH is missing'
case $DATABASE_PATH in /*) ;; *) fail 'DATABASE_PATH must be absolute' ;; esac
[ -n "${AUTH_ORIGIN:-}" ] || fail 'AUTH_ORIGIN is missing'
case $AUTH_ORIGIN in
  https://*) rest=${AUTH_ORIGIN#https://} ;;
  http://127.0.0.1 | http://127.0.0.1:* | http://localhost | http://localhost:* | 'http://[::1]' | 'http://[::1]:'*) rest=${AUTH_ORIGIN#http://} ;;
  *) fail 'AUTH_ORIGIN must be an HTTPS origin, or localhost over HTTP' ;;
esac
case $rest in '' | */* | *\?* | *'#'* | *@* | *' '*) fail 'AUTH_ORIGIN must be an origin with no path, query, fragment or credentials' ;; esac

HOST=${HOST:-127.0.0.1}
case $HOST in 127.0.0.1 | localhost | ::1) ;; *) fail 'HOST must be a loopback address; publish through Tailscale Serve instead' ;; esac
export HOST
if [ -n "${PORT:-}" ]; then
  case $PORT in *[!0-9]*) fail 'PORT must be a number' ;; esac
  [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || fail 'PORT must be from 1 to 65535'
fi

# Keep logs bounded: copy-truncate at each (re)start. launchd keeps the file
# open, so the file is truncated in place rather than renamed.
max=${HUB_LOG_MAX_BYTES:-5242880}
case $max in '' | *[!0-9]*) fail 'HUB_LOG_MAX_BYTES must be a number' ;; esac
if [ -n "$logdir" ] && [ -d "$logdir" ]; then
  for name in stdout stderr; do
    log="$logdir/$name.log"
    if [ -f "$log" ] && [ -w "$log" ]; then
      size=$(( $(wc -c < "$log") ))
      if [ "$size" -gt "$max" ]; then cp -p "$log" "$log.1" && : > "$log"; fi
    fi
  done
fi

PATH="$(dirname -- "$mise"):/usr/bin:/bin"
export PATH
exec "$root/scripts/start.sh"
