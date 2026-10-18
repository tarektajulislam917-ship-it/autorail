#!/usr/bin/env bash
set -euo pipefail

display="${DISPLAY:-:99}"
width="${SCREEN_WIDTH:-1440}"
height="${SCREEN_HEIGHT:-900}"
depth="${SCREEN_DEPTH:-24}"

cleanup() {
  kill "${service_pid:-}" "${novnc_pid:-}" "${vnc_pid:-}" "${wm_pid:-}" "${xvfb_pid:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

Xvfb "$display" -screen 0 "${width}x${height}x${depth}" -ac -nolisten tcp &
xvfb_pid=$!

for _ in $(seq 1 50); do
  if xdpyinfo -display "$display" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

fluxbox -display "$display" >/tmp/fluxbox.log 2>&1 &
wm_pid=$!

x11vnc -display "$display" -localhost -forever -shared -nopw -noxdamage -rfbport 5900 >/tmp/x11vnc.log 2>&1 &
vnc_pid=$!

websockify --web=/usr/share/novnc/ 0.0.0.0:6080 localhost:5900 >/tmp/novnc.log 2>&1 &
novnc_pid=$!

node /app/services/browser-service/dist/index.js &
service_pid=$!
wait "$service_pid"
