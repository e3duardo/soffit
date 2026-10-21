#!/bin/sh
# Runs the smoke test in a headless GNOME Shell that is fully isolated from
# the desktop session: its own D-Bus, dconf, runtime dir and extension dir.
#   tests/run-smoke.sh            prints PASS/FAIL lines
#   KEEP=1 tests/run-smoke.sh     keeps the temp dir (shell.log) for debugging
#   NESTED=1 tests/run-smoke.sh   runs in a visible window instead of headless
set -u

repo=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
mkdir -p "$tmp/config" "$tmp/data/gnome-shell/extensions" "$tmp/run"
chmod 700 "$tmp/run"
ln -s "$repo" "$tmp/data/gnome-shell/extensions/soffit@e3duardo.github.io"
ln -s "$repo/tests/smoke-test@soffit" "$tmp/data/gnome-shell/extensions/smoke-test@soffit"

# A nested shell draws into a window of the desktop's compositor, found
# by absolute socket path since XDG_RUNTIME_DIR is replaced below.
if [ "${NESTED:-}" ]; then
    mode="--nested"
    host_display="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/${WAYLAND_DISPLAY:-wayland-0}"
    # GNOME 48's nested mode opens its window through X11 (XWayland).
    host_x11="${DISPLAY:-:0}"
else
    mode="--headless --virtual-monitor 1280x800"
    host_display= host_x11=
fi

cat > "$tmp/session.sh" <<'EOF'
tmp=$1 mode=$2 host_display=$3 host_x11=$4
export XDG_CONFIG_HOME=$tmp/config XDG_DATA_HOME=$tmp/data XDG_RUNTIME_DIR=$tmp/run
unset WAYLAND_DISPLAY DISPLAY
ext="gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions --method org.gnome.Shell.Extensions"

# shellcheck disable=SC2086
DISPLAY=$host_x11 WAYLAND_DISPLAY=$host_display SOFFIT_TEST_PAUSE=${host_display:+1} \
    gnome-shell $mode --wayland --no-x11 > "$tmp/shell.log" 2>&1 &
shell=$!
for _ in $(seq 1 60); do [ -S "$tmp/run/wayland-0" ] && break; sleep 0.25; done
sleep 3
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.freedesktop.DBus.Properties.Set org.gnome.Shell OverviewActive "<false>" > /dev/null

WAYLAND_DISPLAY=wayland-0 GDK_BACKEND=wayland gnome-text-editor --new-window > /dev/null 2>&1 &
sleep 3
# Only the test is enabled through the settings; it enables Soffit itself
# (two EnableExtension calls race on enabled-extensions here and the
# second one drops the first).
$ext.EnableExtension smoke-test@soffit > /dev/null

for _ in $(seq 1 180); do grep -q '\[soffit-test\] DONE' "$tmp/shell.log" && break; sleep 0.5; done
$ext.GetExtensionErrors soffit@e3duardo.github.io
[ -n "$host_display" ] && sleep 5  # let a watcher see the end state
kill $shell
EOF

echo "extension errors (empty is good):"
timeout 150 dbus-run-session -- sh "$tmp/session.sh" "$tmp" "$mode" "$host_display" "$host_x11" 2>/dev/null |
    grep -vE '^(GNOME_KEYRING|SSH_AUTH|SpiRegistry)'
grep -E '\[soffit(-test)?\]|JS ERROR' "$tmp/shell.log"

if [ "${KEEP:-}" ]; then
    echo "logs kept in $tmp"
else
    rm -rf "$tmp"
fi
