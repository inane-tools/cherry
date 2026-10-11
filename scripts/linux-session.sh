#!/usr/bin/env bash
# App-local workaround for WebKit's additional MPRIS registrations. Flatpak
# applies an equivalent ownership policy, so it does not need this launcher.
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo 'Usage: bash scripts/linux-session.sh COMMAND [ARGS...]' >&2
  exit 2
fi
if [[ -n ${FLATPAK_ID:-} ]]; then
  exec "$@"
fi
command -v xdg-dbus-proxy >/dev/null || {
  echo 'Install xdg-dbus-proxy first (Fedora: sudo dnf install xdg-dbus-proxy).' >&2
  exit 1
}
: "${DBUS_SESSION_BUS_ADDRESS:?Run this from your desktop session}"
: "${XDG_RUNTIME_DIR:?Run this from your desktop session}"

session_dir=$(mktemp -d "$XDG_RUNTIME_DIR/cherry-bus.XXXXXX")
proxy_pid=''
app_pid=''
cleanup() {
  if [[ -n $app_pid ]]; then kill "$app_pid" 2>/dev/null || true; fi
  if [[ -n $proxy_pid ]]; then
    kill "$proxy_pid" 2>/dev/null || true
    wait "$proxy_pid" 2>/dev/null || true
  fi
  rm -f -- "$session_dir/bus"
  rmdir -- "$session_dir" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Keep desktop integration (keyring, portals, notifications, accessibility,
# GTK settings and the KDE tray). Only Cherry's own names may be registered;
# WebKit's org.mpris.MediaPlayer2.org.webkit... name is deliberately excluded.
xdg-dbus-proxy "$DBUS_SESSION_BUS_ADDRESS" "$session_dir/bus" --filter \
  '--talk=org.freedesktop.*' '--talk=org.kde.*' '--talk=org.gnome.*' \
  '--talk=org.a11y.*' '--talk=ca.desrt.*' \
  --own=org.mpris.MediaPlayer2.cherry \
  --own=tools.inane.cherry.SingleInstance &
proxy_pid=$!
for ((attempt=0; attempt<100; attempt++)); do
  [[ -S $session_dir/bus ]] && break
  if ! kill -0 "$proxy_pid" 2>/dev/null; then
    echo 'Cherry session-bus proxy failed to start.' >&2
    exit 1
  fi
  sleep 0.02
done
if [[ ! -S $session_dir/bus ]]; then
  echo 'Cherry session-bus proxy startup timed out.' >&2
  exit 1
fi

DBUS_SESSION_BUS_ADDRESS="unix:path=$session_dir/bus" "$@" &
app_pid=$!
set +e
wait "$app_pid"
status=$?
app_pid=''
exit "$status"
